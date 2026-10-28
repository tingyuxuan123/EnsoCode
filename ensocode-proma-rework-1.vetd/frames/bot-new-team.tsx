export const frame = { width: 1440, height: 900, title: "Bot · 从模板创建团队" };

import { NewGroupForm } from '../components/bot/NewGroupForm';

/** 从模板创建团队（bots/NewTeamDialog）：模板选择、成员能力覆盖、共享/独立工作区、群主与校验 */
export default function BotNewTeam() {
  return <NewGroupForm initial="team" />;
}
