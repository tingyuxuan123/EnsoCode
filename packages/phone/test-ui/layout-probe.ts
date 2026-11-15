/** Read-only checks for the real-component regression fixture. Run in Chromium:
 * import('/test-ui/layout-probe.ts').then(m => m.measurePhoneLayout())
 */
export function measurePhoneLayout() {
  if (
    location.hostname !== '127.0.0.1' ||
    location.pathname !== '/test-ui/' ||
    new URLSearchParams(location.search).get('screen') !== 'regression'
  )
    throw new Error('Use the isolated loopback regression fixture');
  const issues: string[] = [];
  const box = (element: Element | null | undefined) => element?.getBoundingClientRect();
  const disjoint = (a: DOMRect, b: DOMRect) =>
    a.right <= b.left + 0.5 ||
    b.right <= a.left + 0.5 ||
    a.bottom <= b.top + 0.5 ||
    b.bottom <= a.top + 0.5;
  const message = document.querySelector('[data-enso="message-user"]');
  const bubble = message?.querySelector('[data-user-bubble]');
  const body = bubble?.querySelector('[data-user-query]');
  if (!bubble || !body || message?.querySelectorAll('[data-user-bubble]').length !== 1)
    issues.push('Missing one outer text bubble');
  if (bubble) {
    const style = getComputedStyle(bubble);
    const inverse = document.documentElement.classList.contains('dark')
      ? 'rgb(244, 245, 246)'
      : 'rgb(11, 12, 14)';
    if (style.backgroundColor !== inverse)
      issues.push('Outer text bubble is not the inverse surface');
    if (bubble.querySelector('img')) issues.push('Attachment is inside the text bubble');
    if (style.paddingLeft !== '16px' || style.paddingTop !== '12px')
      issues.push('User bubble padding differs from 16/12');
  }
  if (body && getComputedStyle(body).backgroundColor !== 'rgba(0, 0, 0, 0)')
    issues.push('Nested user text has a second background');
  const head = document.querySelector('[data-reply-header]');
  const work = document.querySelector('[data-worklog-head]');
  if (!head || !work) issues.push('Missing reply header or live worklog');
  else {
    if (!disjoint(head.getBoundingClientRect(), work.getBoundingClientRect()))
      issues.push('Reply identity and worklog overlap');
    if (getComputedStyle(work).position === 'absolute')
      issues.push('Worklog is outside document flow');
    const children = [...head.children].filter(
      (element) => getComputedStyle(element).display !== 'none'
    );
    for (let i = 0; i < children.length; i++)
      for (let j = i + 1; j < children.length; j++)
        if (!disjoint(children[i].getBoundingClientRect(), children[j].getBoundingClientRect()))
          issues.push('Reply header fields overlap');
    const model = head.querySelector('[data-reply-model]');
    if (model && getComputedStyle(model).display !== 'none')
      issues.push('Reply header repeats model selection');
  }
  const duplicate = document.querySelector('[data-timeline-busy]');
  if (duplicate && getComputedStyle(duplicate).display !== 'none')
    issues.push('Duplicated generating indicator');
  const dock = document.querySelector('.phone-code-dock');
  const expectedSafe = Math.max(
    8,
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--phone-safe-bottom')
    ) || 0
  );
  if (!dock || Number.parseFloat(getComputedStyle(dock).paddingBottom) !== expectedSafe)
    issues.push('Bottom gap is not safe-area aware');
  if (dock && Math.abs(dock.getBoundingClientRect().bottom - innerHeight) > 1)
    issues.push('App does not fill visible viewport');
  if (document.documentElement.scrollWidth > innerWidth) issues.push('Horizontal overflow');
  return {
    issues,
    viewport: { width: innerWidth, height: innerHeight },
    bubble: box(bubble)?.toJSON(),
    header: box(head)?.toJSON(),
    worklog: box(work)?.toJSON(),
    dock: box(dock)?.toJSON(),
    paddingBottom: dock && getComputedStyle(dock).paddingBottom,
  };
}
