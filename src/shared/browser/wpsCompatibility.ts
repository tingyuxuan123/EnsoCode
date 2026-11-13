const WPS_ORIGIN = 'https://ap.wps.com';
const STATIC_ORIGIN = 'https://global-static.wpscdn.com';
const DUPLICATE_PREFIX = '/docs/weboffice-static/weboffice-static/js/';
const CANONICAL_PREFIX = '/docs/weboffice-static/js/';

/**
 * WPS 国际分享编辑器会返回重复 weboffice-static 的脚本/样式地址。
 * 两个地址均经实际请求核对：重复路径 404，去重后的同源资源 200。
 * 只兼容已确认的站点和静态资源，不改文档导航、API、凭证或其它 CDN。
 */
export function wpsStaticResourceRedirect(
  requestUrl: string,
  pageUrl: string | undefined,
  resourceType: string
): string | undefined {
  if (!pageUrl || (resourceType !== 'script' && resourceType !== 'stylesheet')) return;
  try {
    const page = new URL(pageUrl);
    const asset = new URL(requestUrl);
    if (
      page.origin !== WPS_ORIGIN ||
      page.username ||
      page.password ||
      asset.origin !== STATIC_ORIGIN ||
      asset.username ||
      asset.password ||
      !asset.pathname.startsWith(DUPLICATE_PREFIX) ||
      !asset.pathname.endsWith(resourceType === 'script' ? '.js' : '.css')
    )
      return;
    asset.pathname = CANONICAL_PREFIX + asset.pathname.slice(DUPLICATE_PREFIX.length);
    return asset.href;
  } catch {
    return;
  }
}
