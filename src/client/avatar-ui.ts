type Avatar = (name: string, kind: "user" | "bot" | "system", size?: number, avatarValue?: string) => HTMLElement;
let avatarUi: Avatar | null = null;
export const setAvatarUi = (avatar: Avatar): void => { avatarUi = avatar; };
export const avatar: Avatar = (...args) => avatarUi!(...args);
