export const frame = { width: 1440, height: 900, title: "远程 · 新建远程会话" };

import { Dialog, Field } from '../components/Controls';
import { Overlay } from '../components/Workbench';
import { RemoteChat } from '../components/remote/RemoteChat';

/** 新建远程会话：项目、提供商、模型、审批档位、推理与思考档位；会话在对方电脑上跑 */
export default function RemoteNewSessionFrame() {
  return (
    <>
      <RemoteChat />
      <Overlay>
        <Dialog
          title="新建远程会话"
          description="会话在对方电脑上运行，用的是对方的项目、模型与密钥。"
          width={520}
          onClose={() => undefined}
          footer={
            <>
              <button className="px-3 py-2 text-[12px] text-muted">取消</button>
              <button className="rounded-control bg-surface-foreground px-4 py-2 text-[12px] text-surface">创建</button>
            </>
          }
        >
          <Field label="项目">
            <select className="h-9 w-full rounded-control border border-border bg-input px-2 text-[13px]">
              <option>EnsoCode · ~/githubproject/EnsoCode</option>
              <option>relay-service · /srv/relay-service</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="提供商">
              <select className="h-9 w-full rounded-control border border-border bg-input px-2 text-[13px]">
                <option>Anthropic</option>
                <option>OpenAI</option>
              </select>
            </Field>
            <Field label="模型">
              <select className="h-9 w-full rounded-control border border-border bg-input px-2 text-[13px]">
                <option>Claude Sonnet 4.5</option>
                <option>GPT-5 Codex</option>
              </select>
            </Field>
          </div>
          <Field label="审批档位">
            <select className="h-9 w-full rounded-control border border-border bg-input px-2 text-[13px]">
              <option>自动接受编辑</option>
              <option>全程审批</option>
              <option>完全放行</option>
            </select>
          </Field>
          <div className="flex items-center gap-3 text-[12px] text-muted">
            <label className="flex items-center gap-1.5"><input type="checkbox" defaultChecked />推理</label>
            <label className="flex items-center gap-1.5">思考档位<select className="h-7 rounded-control border border-border bg-input px-1.5 text-[12px]"><option>中</option><option>高</option><option>低</option></select></label>
          </div>
        </Dialog>
      </Overlay>
    </>
  );
}
