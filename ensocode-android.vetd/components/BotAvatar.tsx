import type { Bot } from "./data";

/**
 * 成员头像：头像色上的名字首字；运行中右下角一颗蓝点，排队中一颗灰点。
 * 小于 26px 时字会低于 11px 读不清，只留头像色。
 */
export function BotAvatar({ bot, size = 40, ring = false }: { bot: Bot; size?: number; ring?: boolean }) {
	const dot = bot.status === "running" ? "bg-blue" : bot.status === "queued" ? "bg-faint" : null;
	return (
		<span
			aria-label={bot.name}
			className={`relative inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white ${
				ring ? "ring-2 ring-page" : ""
			}`}
			style={{ width: size, height: size, background: bot.color, fontSize: Math.round(size * 0.42) }}
		>
			{size >= 26 && bot.name.slice(0, 1)}
			{dot && size >= 32 && (
				<span className={`absolute right-0 bottom-0 size-3 rounded-full ring-2 ring-page ${dot}`} />
			)}
		</span>
	);
}
