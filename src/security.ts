export function isPrivateOwner(
  userId: number | undefined,
  chatType: string | undefined,
  ownerId: number,
): boolean {
  return userId === ownerId && chatType === "private";
}
