import { CreateRoomPage } from './CreateRoomPage';
import { RoomPage } from './RoomPage';
import { SoloPage } from './SoloPage';

/**
 * Three screens, so a router library isn't worth it:
 *   /              one-device translator (Milestone 1)
 *   /conversation  start a two-device conversation
 *   /r/:roomId     join or rejoin one (the secret is in the #fragment)
 */
export function App() {
  const path = window.location.pathname;
  const room = /^\/r\/([A-Za-z0-9_-]{1,64})\/?$/.exec(path);
  if (room?.[1]) {
    return <RoomPage roomId={room[1]} secret={window.location.hash.slice(1)} />;
  }
  if (path === '/conversation' || path === '/conversation/') return <CreateRoomPage />;
  return <SoloPage />;
}
