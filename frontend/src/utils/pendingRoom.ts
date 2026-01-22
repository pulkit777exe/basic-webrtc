const PENDING_ROOM_KEY = "pendingRoom";

export const setPendingRoom = (roomId: string): void => {
  localStorage.setItem(PENDING_ROOM_KEY, roomId);
};

export const getPendingRoom = (): string | null => {
  return localStorage.getItem(PENDING_ROOM_KEY);
};

export const clearPendingRoom = (): void => {
  localStorage.removeItem(PENDING_ROOM_KEY);
};
