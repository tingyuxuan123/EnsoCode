import { useEffect, useMemo, useRef, useState } from "react";
import { DesignSystemPreview } from "../canvas/DesignSystemPreview";
import type { DesignSystem } from "../design-systems/types";
import { cachedStyleCover, loadStyleCover, styleCoverRef, type StyleCoverRef } from "./style-cover";

/** Keep the palette visible until the static WebP has loaded; no remote URL reaches the DOM. */
export function StyleCover({ system }: { system: DesignSystem }) {
	const cover = useMemo(() => styleCoverRef(system), [system]);
	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
			<DesignSystemPreview system={system} className="absolute inset-0" />
			{cover ? <CoverImage key={cover.key} cover={cover} /> : null}
		</div>
	);
}

function CoverImage({ cover }: { cover: StyleCoverRef }) {
	const box = useRef<HTMLDivElement | null>(null);
	const [src, setSrc] = useState(() => cachedStyleCover(cover));
	const [status, setStatus] = useState<"loading" | "shown" | "failed">("loading");

	useEffect(() => {
		const element = box.current;
		if (!element || src) return;
		let cancelled = false;
		const load = () => {
			void loadStyleCover(cover).then((dataUrl) => {
				if (!cancelled && dataUrl) setSrc(dataUrl);
			});
		};
		const observer = new IntersectionObserver((entries) => {
			if (cancelled || !entries.some((entry) => entry.isIntersecting)) return;
			observer.disconnect();
			load();
		}, { rootMargin: "400px" });
		observer.observe(element);
		return () => {
			cancelled = true;
			observer.disconnect();
		};
	}, [cover, src]);

	return (
		<div ref={box} className="absolute inset-0">
			{src && status !== "failed" ? (
				<img
					src={src}
					alt=""
					draggable={false}
					decoding="async"
					onLoad={() => setStatus("shown")}
					onError={() => setStatus("failed")}
					className="absolute inset-0 h-full w-full select-none object-cover object-top transition-opacity duration-300"
					style={{ opacity: status === "shown" ? 1 : 0 }}
				/>
			) : null}
		</div>
	);
}
