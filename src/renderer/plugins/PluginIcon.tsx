import { Puzzle } from 'lucide-react';
import { useEffect, useState } from 'react';
export function PluginIcon({
  pluginId,
  icon,
  className,
}: {
  pluginId: string;
  icon?: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setSrc(null);
    if (icon)
      void window.electronAPI.extensionPlugins
        .asset(pluginId, icon)
        .then((result) => {
          if (active && result.ok && /^image\/(png|jpeg|gif|webp|svg\+xml|avif)$/.test(result.mime))
            setSrc(`data:${result.mime};base64,${result.base64}`);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [pluginId, icon]);
  return src ? <img src={src} alt="" className={className} /> : <Puzzle className={className} />;
}
