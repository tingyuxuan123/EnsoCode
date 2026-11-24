/** host 按作用域拦截写命令时的错误码 */
export const READ_ONLY_ERROR = 'read-only';

/** 只读横幅；rejected = 刚有写操作被桌面拦下 */
export const readOnlyBanner = (rejected = false): string =>
  rejected
    ? '此设备为只读，刚才的操作未执行；可在桌面「设置 → 设备」切换为可操作'
    : '此设备为只读，只能查看；可在桌面「设置 → 设备」切换为可操作';
