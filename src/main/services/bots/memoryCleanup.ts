/** 删除 Bot / 群后等待在途编译收尾，清理派生索引与 Collabra 托管目录（不动用户外部 Vault）。 */
export async function removeBotMemorySpace(_userData: string, spaceId: string): Promise<void> {
  const host = await import('../memoryHost');
  await host.removeSpaceCompletely(spaceId);
}
