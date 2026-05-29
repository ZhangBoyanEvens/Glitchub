import { Outlet } from 'react-router-dom'

/** Hosts 子路由容器：顶栏由外层 DashboardLayout 提供，此处仅渲染子页 */
export function DashboardHostsLayout() {
  return <Outlet />
}
