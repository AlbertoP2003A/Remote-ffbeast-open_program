use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=assets/ffbeast.ico");
    println!("cargo:rerun-if-changed=build.rs");

    if !cfg!(target_os = "windows") {
        return;
    }

    let manifest_dir =
        PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    // windres no maneja bien rutas con espacios; se compila en una carpeta
    // temporal sin espacios y se enlaza el .res resultante.
    let temp = std::env::temp_dir().join("ffbeast-hub-resource");
    fs::create_dir_all(&temp).expect("no se pudo crear la carpeta temporal del recurso");
    fs::copy(
        manifest_dir.join("assets").join("ffbeast.ico"),
        temp.join("ffbeast.ico"),
    )
    .expect("no se pudo copiar el icono");

    let version = env!("CARGO_PKG_VERSION");
    let mut parts: Vec<String> = version.split('.').map(ToString::to_string).collect();
    while parts.len() < 4 {
        parts.push("0".to_string());
    }
    let version4 = parts[..4].join(".");
    let version_comma = parts[..4].join(",");

    let rc = format!(
        r#"1 VERSIONINFO
FILEVERSION {version_comma}
PRODUCTVERSION {version_comma}
FILEFLAGSMASK 0x3fL
FILEFLAGS 0x0L
FILEOS 0x40004L
FILETYPE 0x1L
FILESUBTYPE 0x0L
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "040904b0"
    BEGIN
      VALUE "CompanyName", "FFBeast Remote\0"
      VALUE "FileDescription", "FFBeast Remote Hub\0"
      VALUE "FileVersion", "{version4}\0"
      VALUE "InternalName", "ffbeast-hub\0"
      VALUE "LegalCopyright", "MIT License\0"
      VALUE "OriginalFilename", "ffbeast-hub.exe\0"
      VALUE "ProductName", "FFBeast Remote\0"
      VALUE "ProductVersion", "{version4}\0"
    END
  END
  BLOCK "VarFileInfo"
  BEGIN
    VALUE "Translation", 0x409, 1200
  END
END

1 ICON "ffbeast.ico"
"#
    );
    fs::write(temp.join("resource.rc"), rc).expect("no se pudo escribir resource.rc");

    let status = match Command::new("windres")
        .current_dir(&temp)
        .args(["resource.rc", "-O", "coff", "-o", "resource.res"])
        .status()
    {
        Ok(status) => status,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // El icono y la version son opcionales; el hub funciona sin ellos.
            // Asi se puede compilar el .exe en equipos sin WinLibs.
            println!(
                "cargo:warning=windres no encontrado; se omite el icono y la version del .exe"
            );
            return;
        }
        Err(error) => panic!("no se pudo ejecutar windres: {error}"),
    };
    if !status.success() {
        panic!("windres falló al compilar el recurso de Windows");
    }

    let resource = temp.join("resource.res");
    println!("cargo:rustc-link-arg={}", resource.display());
}
