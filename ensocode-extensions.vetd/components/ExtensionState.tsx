import { createContext, useContext, useState, type ReactNode } from "react";
import { initialExtensions, type Extension } from "./data";

type Modal = "add-mcp" | "import" | "compose" | null;
export type Filter = "all" | "skill" | "mcp";
type State = {
  extensions: Extension[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  scope: "installed" | "discover";
  setScope: (scope: "installed" | "discover") => void;
  query: string;
  setQuery: (query: string) => void;
  filter: Filter;
  setFilter: (filter: Filter) => void;
  modal: Modal;
  setModal: (modal: Modal) => void;
  notice: string;
  setNotice: (text: string) => void;
  toggle: (id: string) => void;
  install: (id: string) => void;
  authorize: (id: string) => void;
  add: (entry: Extension) => void;
};

const Context = createContext<State | null>(null);

export function ExtensionProvider({ children }: { children: ReactNode }) {
  const [extensions, setExtensions] = useState(initialExtensions);
  const [selectedId, setSelectedId] = useState("design");
  const [scope, setScope] = useState<"installed" | "discover">("installed");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [modal, setModal] = useState<Modal>(null);
  const [notice, setNotice] = useState("");
  const update = (id: string, change: Partial<Extension>) => setExtensions((items) => items.map((item) => item.id === id ? { ...item, ...change } : item));
  return (
    <Context.Provider value={{
      extensions, selectedId, setSelectedId, scope, setScope, query, setQuery, filter, setFilter, modal, setModal, notice, setNotice,
      toggle: (id) => {
        const item = extensions.find((entry) => entry.id === id);
        if (item) {
          update(id, { enabled: !item.enabled });
          setNotice(`演示：${item.name}已${item.enabled ? "停用" : "启用"}，不会修改真实会话。`);
        }
      },
      install: (id) => {
        const item = extensions.find((entry) => entry.id === id);
        update(id, { installed: true, enabled: true, ready: item?.type === "mcp" ? false : undefined });
        setNotice(`演示：已添加${item?.name ?? "扩展"}，未执行真实安装。`);
      },
      authorize: (id) => {
        update(id, { ready: true });
        setNotice("演示：连接已切换为就绪状态，未请求真实账号授权。");
      },
      add: (entry) => {
        setExtensions((items) => [...items, entry]);
        setModal(null);
        setNotice("已添加到演示目录，真实配置未改动。");
      },
    }}>
      {children}
    </Context.Provider>
  );
}

export function useExtensions() {
  const value = useContext(Context);
  if (!value) throw new Error("ExtensionProvider is required");
  return value;
}
