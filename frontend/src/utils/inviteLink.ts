export const generateInviteLink = (roomId: string): string => {
  const baseUrl = window.location.origin;
  return `${baseUrl}/room/${encodeURIComponent(roomId)}`;
};

export const getRoomFromUrl = (): string | null => {
  const match = window.location.pathname.match(/^\/room\/(.+)$/);
  if (match) {
    return decodeURIComponent(match[1]);
  }
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get("room");
};

export const clearRoomFromUrl = (): void => {
  window.history.replaceState({}, "", window.location.pathname);
};
