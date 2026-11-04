import { Outlet } from "react-router";
import { ExtensionProvider } from "../components/ExtensionState";
import { WorkspaceShell } from "../components/WorkspaceShell";

export default function Layout() {
  return (
    <ExtensionProvider>
      <WorkspaceShell>
        <Outlet />
      </WorkspaceShell>
    </ExtensionProvider>
  );
}
