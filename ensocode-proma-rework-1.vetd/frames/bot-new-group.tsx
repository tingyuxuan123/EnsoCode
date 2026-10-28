export const frame = { width: 1440, height: 900, title: "Bot · 新建群聊" };

import { NewGroupForm } from '../components/bot/NewGroupForm';

/** 新建群聊：成员（至少两位并指定群主）、共享/独立工作区、@ 接力上限、复制范围说明 */
export default function NewGroupScreen() {
  return <NewGroupForm />;
}
