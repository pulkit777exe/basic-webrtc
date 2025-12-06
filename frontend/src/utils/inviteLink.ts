export const generateInviteLink = (roomName: string): string => {
  const baseUrl = window.location.origin;
  return `${baseUrl}?room=${encodeURIComponent(roomName)}`;
};

export const getRoomFromUrl = (): string | null => {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get("room");
};

export const clearRoomFromUrl = (): void => {
  window.history.replaceState({}, "", window.location.pathname);
};

