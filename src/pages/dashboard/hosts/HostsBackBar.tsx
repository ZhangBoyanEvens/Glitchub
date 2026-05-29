import { Link } from 'react-router-dom'

type HostsBackBarProps = {
  /** Sub-page title, shown to the right of the back control */
  pageTitle: string
}

export function HostsBackBar({ pageTitle }: HostsBackBarProps) {
  return (
    <header className="dashboard__hostsSubHeader">
      <Link to="/dashboard/hosts" className="dashboard__hostsBackBtn" replace>
        <span className="dashboard__hostsBackBtnIcon" aria-hidden>
          ←
        </span>
        <span className="dashboard__hostsBackBtnText">Back to lobby</span>
      </Link>
      <span className="dashboard__hostsSubTitle">{pageTitle}</span>
    </header>
  )
}
