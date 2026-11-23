import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Icon } from "./components/Icons";
import { Spinner } from "./components/ui";
import { useHub } from "./hub";
import { Axes } from "./pages/Axes";
import { Buttons } from "./pages/Buttons";
import { Dashboard } from "./pages/Dashboard";
import { Effects } from "./pages/Effects";
import { Hardware } from "./pages/Hardware";
import { Monitoring } from "./pages/Monitoring";
import { More } from "./pages/More";
import { Offline } from "./pages/Offline";
import { Pairing } from "./pages/Pairing";
import { Pins } from "./pages/Pins";
import { Profiles } from "./pages/Profiles";
import { Settings } from "./pages/Settings";

function Splash(): React.ReactElement {
  return (
    <div className="gate">
      <div className="gate-card center">
        <div className="gate-brand">
          <span className="brand-mark">
            <Icon name="wheel" size={26} />
          </span>
          <div>
            <strong>FFBeast</strong>
            <span>Remote</span>
          </div>
        </div>
        <Spinner label="Conectando con el hub…" />
      </div>
    </div>
  );
}

export default function App(): React.ReactElement {
  const { authState } = useHub();

  if (authState === "checking") return <Splash />;
  if (authState === "needs-token") return <Pairing />;
  if (authState === "offline") return <Offline />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/effects" element={<Effects />} />
        <Route path="/hardware" element={<Hardware />} />
        <Route path="/profiles" element={<Profiles />} />
        <Route path="/monitoring" element={<Monitoring />} />
        <Route path="/pins" element={<Pins />} />
        <Route path="/buttons" element={<Buttons />} />
        <Route path="/axes" element={<Axes />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/more" element={<More />} />
        <Route path="/m" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
