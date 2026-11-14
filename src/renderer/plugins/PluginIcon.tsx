import { Puzzle } from 'lucide-react';
import { useEffect, useState } from 'react';

/** 允许内联的图片类型；其它 mime 交给默认图标，不把任意资源当图片渲染。 */
const IMAGE_MIME = /^image\/(png|jpeg|gif|webp|svg\+xml|avif)$/;

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
  // 回了图片 mime 但内容损坏时浏览器会触发 error，不能把破图留在界面上。
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    let active = true;
    setSrc(null);
    setBroken(false);
    if (icon)
      void window.electronAPI.extensionPlugins
        .asset(pluginId, icon)
        .then((result) => {
          if (active && result.ok && IMAGE_MIME.test(result.mime))
            setSrc(`data:${result.mime};base64,${result.base64}`);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [pluginId, icon]);
  if (!src || broken) return <Puzzle data-slot="plugin-icon-fallback" className={className} />;
  return (
    <img
      data-slot="plugin-icon"
      src={src}
      alt=""
      className={className}
      onError={() => setBroken(true)}
    />
  );
}
