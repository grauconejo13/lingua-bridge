import { AudiencePage } from './AudiencePage';
import { CreateRoomPage } from './CreateRoomPage';
import { CreateTalkPage } from './CreateTalkPage';
import { PresenterPage } from './PresenterPage';
import { RoomPage } from './RoomPage';
import { SoloPage } from './SoloPage';

/**
 * A handful of screens, so a router library isn't worth it:
 *   /              one-device translator (Milestone 1)
 *   /conversation  start a two-device conversation
 *   /r/:roomId     join or rejoin one (the secret is in the #fragment)
 *   /present       start a presentation (Milestone 3)
 *   /present/:id   the presenter's controls (the presenter key is in the #fragment)
 *   /t/:id         follow a presentation as a listener
 */
export function App() {
  const path = window.location.pathname;
  const room = /^\/r\/([A-Za-z0-9_-]{1,64})\/?$/.exec(path);
  if (room?.[1]) {
    return <RoomPage roomId={room[1]} secret={window.location.hash.slice(1)} />;
  }
  if (path === '/conversation' || path === '/conversation/') return <CreateRoomPage />;
  const presenter = /^\/present\/([A-Za-z0-9_-]{1,64})\/?$/.exec(path);
  if (presenter?.[1]) {
    return <PresenterPage talkId={presenter[1]} presenterKey={window.location.hash.slice(1)} />;
  }
  if (path === '/present' || path === '/present/') return <CreateTalkPage />;
  const audience = /^\/t\/([A-Za-z0-9_-]{1,64})\/?$/.exec(path);
  if (audience?.[1]) return <AudiencePage talkId={audience[1]} />;
  return <SoloPage />;
}
