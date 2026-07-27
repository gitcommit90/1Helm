import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { getToken, type User } from "./api.ts";
import { serverWebSocketUrl } from "./mobile.ts";

export type CoworkAwarenessUser = {
  id: number;
  username: string;
  name: string;
  avatar: string;
  color: string;
  colorLight: string;
};

export type CoworkDocument = {
  doc: Y.Doc;
  provider: WebsocketProvider;
  text: Y.Text;
  scene: Y.Map<string>;
  awarenessUsers: () => CoworkAwarenessUser[];
  setActive: (active: boolean) => void;
  destroy: () => void;
};

function userColor(id: number, username: string): string {
  let hash = id || 17;
  for (const character of username) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 68% 48%)`;
}

export function connectCoworkDocument(channelId: number, path: string, me: User): CoworkDocument {
  const doc = new Y.Doc();
  const target = new URL(serverWebSocketUrl(`/ws/cowork/${channelId}/document`));
  const serverUrl = `${target.protocol}//${target.host}${target.pathname.replace(/\/document$/, "")}`;
  const room = "document";
  const provider = new WebsocketProvider(serverUrl, room, doc, {
    params: { token: getToken(), path },
    disableBc: true,
    maxBackoffTime: 3_000,
  });
  const color = userColor(me.id, me.username);
  provider.awareness.setLocalStateField("user", {
    id: me.id,
    username: me.username,
    name: me.display,
    avatar: me.avatar,
    color,
    colorLight: `color-mix(in srgb, ${color} 22%, transparent)`,
  } satisfies CoworkAwarenessUser);
  const awarenessUsers = (): CoworkAwarenessUser[] => {
    const users = new Map<number, CoworkAwarenessUser>();
    for (const state of provider.awareness.getStates().values()) {
      const user = state.user as CoworkAwarenessUser | undefined;
      if (user?.id) users.set(user.id, user);
    }
    return [...users.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
  return {
    doc,
    provider,
    text: doc.getText("content"),
    scene: doc.getMap<string>("scene"),
    awarenessUsers,
    setActive: (active) => { if (active) provider.connect(); else provider.disconnect(); },
    destroy: () => { provider.destroy(); doc.destroy(); },
  };
}
