export const frame = { width: 1040, height: 360, title: "CodeKiln · 选中后：技能胶囊" };

import SlashPanel from "../components/SlashPanel";
import { groups } from "../components/commands";

export default function Selected() {
  const designSkill = groups.flatMap(group => group.items).find(item => item.builtin === "design");
  return <SlashPanel initialSkill={designSkill} detail />;
}
