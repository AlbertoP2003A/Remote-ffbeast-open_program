use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use tray_icon::menu::{
    CheckMenuItem, Menu, MenuEvent, MenuId, MenuItem, PredefinedMenuItem,
};
use tray_icon::{
    Icon, MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent,
};
use winit::application::ApplicationHandler;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::window::WindowId;

use crate::config::{app_data_dir, save_config, AppConfig};
use crate::hid::driver::WheelDevice;
use crate::logger::Logger;
use crate::platform::{open_browser, open_folder};
use crate::startup;

enum UserEvent {
    Tray(TrayIconEvent),
    Menu(MenuEvent),
}

struct TrayApp {
    config: Arc<RwLock<AppConfig>>,
    device: WheelDevice,
    port: u16,
    log: Logger,
    tray: Option<TrayIcon>,
    status_item: Option<MenuItem>,
    read_only_item: Option<CheckMenuItem>,
    autostart_item: Option<CheckMenuItem>,
    open_id: Option<MenuId>,
    read_only_id: Option<MenuId>,
    autostart_id: Option<MenuId>,
    data_id: Option<MenuId>,
    quit_id: Option<MenuId>,
    error: Option<String>,
}

impl TrayApp {
    fn create_tray(&mut self) -> Result<(), String> {
        let config = self.config.read().expect("config lock").clone();
        let status = MenuItem::new("Volante: desconectado", false, None);
        let open = MenuItem::new("Abrir interfaz", true, None);
        let read_only = CheckMenuItem::new(
            "Modo solo lectura",
            true,
            config.read_only,
            None,
        );
        let autostart = CheckMenuItem::new(
            "Iniciar con Windows",
            true,
            config.autostart,
            None,
        );
        let data = MenuItem::new("Abrir carpeta de datos", true, None);
        let quit = MenuItem::new("Salir", true, None);
        let separator_one = PredefinedMenuItem::separator();
        let separator_two = PredefinedMenuItem::separator();

        let menu = Menu::new();
        menu.append_items(&[
            &status,
            &separator_one,
            &open,
            &read_only,
            &autostart,
            &data,
            &separator_two,
            &quit,
        ])
        .map_err(|error| error.to_string())?;

        let tray = TrayIconBuilder::new()
            .with_menu(Box::new(menu))
            .with_tooltip("FFBeast Remote")
            .with_icon(load_icon()?)
            .with_menu_on_left_click(false)
            .build()
            .map_err(|error| error.to_string())?;

        self.open_id = Some(open.id().clone());
        self.read_only_id = Some(read_only.id().clone());
        self.autostart_id = Some(autostart.id().clone());
        self.data_id = Some(data.id().clone());
        self.quit_id = Some(quit.id().clone());
        self.status_item = Some(status);
        self.read_only_item = Some(read_only);
        self.autostart_item = Some(autostart);
        self.tray = Some(tray);
        self.refresh();
        Ok(())
    }

    fn refresh(&self) {
        let status = self.device.status(None);
        let text = if status.connected {
            format!(
                "Volante: conectado · FW {}",
                status.firmware.as_deref().unwrap_or("?")
            )
        } else {
            "Volante: desconectado".to_string()
        };
        if let Some(item) = &self.status_item {
            item.set_text(&text);
        }
        if let Some(tray) = &self.tray {
            let _ = tray.set_tooltip(Some(format!("FFBeast Remote — {text}")));
        }

        let config = self.config.read().expect("config lock");
        if let Some(item) = &self.read_only_item {
            item.set_checked(config.read_only);
        }
        if let Some(item) = &self.autostart_item {
            item.set_checked(config.autostart);
        }
    }

    fn toggle_read_only(&self) {
        let next = {
            let mut config = self.config.write().expect("config lock");
            config.read_only = !config.read_only;
            let next = config.read_only;
            if let Err(error) = save_config(&config) {
                self.log
                    .warn(format!("No se pudo guardar el modo solo lectura: {error}"));
            }
            next
        };
        self.device.set_read_only(next);
        if let Some(item) = &self.read_only_item {
            item.set_checked(next);
        }
        self.log.info(format!(
            "Modo solo lectura {}",
            if next { "activado" } else { "desactivado" }
        ));
    }

    fn toggle_autostart(&self) {
        let current = self.config.read().expect("config lock").autostart;
        let next = !current;
        if let Err(error) = startup::set_enabled(next) {
            self.log
                .warn(format!("No se pudo cambiar el autostart: {error}"));
            return;
        }
        {
            let mut config = self.config.write().expect("config lock");
            config.autostart = next;
            if let Err(error) = save_config(&config) {
                self.log.warn(format!("No se pudo guardar el autostart: {error}"));
            }
        }
        if let Some(item) = &self.autostart_item {
            item.set_checked(next);
        }
        self.log.info(format!(
            "Autostart {}",
            if next { "activado" } else { "desactivado" }
        ));
    }

    fn handle_menu(&self, event_loop: &ActiveEventLoop, event: MenuEvent) {
        let id = event.id();
        if Some(id) == self.open_id.as_ref() {
            open_browser(&format!("http://localhost:{}/", self.port));
        } else if Some(id) == self.read_only_id.as_ref() {
            self.toggle_read_only();
        } else if Some(id) == self.autostart_id.as_ref() {
            self.toggle_autostart();
        } else if Some(id) == self.data_id.as_ref() {
            open_folder(&app_data_dir());
        } else if Some(id) == self.quit_id.as_ref() {
            self.log.info("Cerrando desde la bandeja");
            event_loop.exit();
        }
    }
}

impl ApplicationHandler<UserEvent> for TrayApp {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.tray.is_some() {
            return;
        }
        if let Err(error) = self.create_tray() {
            self.error = Some(error);
            event_loop.exit();
        }
    }

    fn user_event(&mut self, event_loop: &ActiveEventLoop, event: UserEvent) {
        match event {
            UserEvent::Menu(event) => self.handle_menu(event_loop, event),
            UserEvent::Tray(event) => {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    open_browser(&format!("http://localhost:{}/", self.port));
                }
            }
        }
    }

    fn window_event(
        &mut self,
        _event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        _event: WindowEvent,
    ) {
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        self.refresh();
        event_loop.set_control_flow(ControlFlow::WaitUntil(
            Instant::now() + Duration::from_millis(500),
        ));
    }
}

fn load_icon() -> Result<Icon, String> {
    let bytes = include_bytes!("../assets/icon-192.png");
    let image = image::load_from_memory(bytes)
        .map_err(|error| error.to_string())?
        .into_rgba8();
    let resized = image::imageops::resize(
        &image,
        32,
        32,
        image::imageops::FilterType::Lanczos3,
    );
    let (width, height) = resized.dimensions();
    Icon::from_rgba(resized.into_raw(), width, height).map_err(|error| error.to_string())
}

pub fn run(
    config: Arc<RwLock<AppConfig>>,
    device: WheelDevice,
    port: u16,
    log: Logger,
) -> anyhow::Result<()> {
    let event_loop = EventLoop::<UserEvent>::with_user_event()
        .build()
        .map_err(|error| anyhow::anyhow!("no se pudo crear el event loop de la bandeja: {error}"))?;
    event_loop.set_control_flow(ControlFlow::Wait);

    let proxy = event_loop.create_proxy();
    TrayIconEvent::set_event_handler(Some(move |event| {
        let _ = proxy.send_event(UserEvent::Tray(event));
    }));
    let proxy = event_loop.create_proxy();
    MenuEvent::set_event_handler(Some(move |event| {
        let _ = proxy.send_event(UserEvent::Menu(event));
    }));

    let mut app = TrayApp {
        config,
        device,
        port,
        log,
        tray: None,
        status_item: None,
        read_only_item: None,
        autostart_item: None,
        open_id: None,
        read_only_id: None,
        autostart_id: None,
        data_id: None,
        quit_id: None,
        error: None,
    };

    event_loop
        .run_app(&mut app)
        .map_err(|error| anyhow::anyhow!("la bandeja terminó con error: {error}"))?;

    if let Some(error) = app.error {
        anyhow::bail!(error);
    }
    Ok(())
}
