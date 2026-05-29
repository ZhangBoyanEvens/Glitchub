import { Link } from 'react-router-dom'

const HOST_CARDS = [
  {
    id: 'book',
    to: '/dashboard/hosts/book',
    title: 'Book a Room',
    subtitle: 'Lock in time and games ahead',
    body: 'Create or request a room; the host confirms members and start time. Good for planned sessions and avoiding last-minute conflicts.',
    accent: 'book' as const,
  },
  {
    id: 'lobby',
    to: '/dashboard/hosts/lobby',
    title: 'Instant Lobby',
    subtitle: 'Same code, in person',
    body: 'Agree on a 4–6 digit room code with people nearby and enter it to join the same room. The first person to create that code becomes host; the room dissolves when everyone leaves.',
    accent: 'lobby' as const,
  },
  {
    id: 'join',
    to: '/dashboard/hosts/join',
    title: 'Join Room',
    subtitle: 'Room code or invitation',
    body: 'Enter a room ID or follow a shared link to join directly. For members who already have the code.',
    accent: 'join' as const,
  },
]

export function DashboardHostsHome() {
  return (
    <section className="dashboard__panel dashboard__hosts">
      <h1 className="dashboard__panelTitle">Hosts</h1>
      <p className="dashboard__panelLead">
        Room lobby: choose how to enter. Use &quot;Back to menu&quot; in the top-left of sub-pages to return here.
      </p>

      <div className="dashboard__hostsGrid" role="list">
        {HOST_CARDS.map((card) => (
          <article
            key={card.id}
            className={`dashboard__hostCard dashboard__hostCard--${card.accent}`}
            role="listitem"
          >
            <div className="dashboard__hostCardGlow" aria-hidden />
            <div className="dashboard__hostCardInner">
              <p className="dashboard__hostCardKicker">{card.subtitle}</p>
              <h2 className="dashboard__hostCardTitle">{card.title}</h2>
              <p className="dashboard__hostCardBody">{card.body}</p>
              <div className="dashboard__hostCardActions">
                <Link to={card.to} className="dashboard__hostCardBtn">
                  Enter
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
