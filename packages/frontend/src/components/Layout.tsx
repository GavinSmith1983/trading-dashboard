import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  TrendingUp,
  Lightbulb,
  ListChecks,
  Package,
  Store,
  Truck,
  Settings,
  Upload,
  PoundSterling,
  LogOut,
  User,
  ChevronLeft,
  ChevronRight,
  Building2,
  Users,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import AccountSwitcher from './AccountSwitcher';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/sales', label: 'Sales', icon: TrendingUp },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/insights', label: 'Insights', icon: Lightbulb },
  { to: '/proposals', label: 'Proposals', icon: ListChecks },
  { to: '/channels', label: 'Channels', icon: Store },
  { to: '/delivery-costs', label: 'Delivery Costs', icon: Truck },
  { to: '/rules', label: 'Pricing Rules', icon: Settings },
  { to: '/import', label: 'Import', icon: Upload },
];

// Admin-only navigation items (super-admin)
const adminNavItems = [
  { to: '/admin/accounts', label: 'Accounts', icon: Building2 },
  { to: '/admin/users', label: 'Users', icon: Users },
];

export default function Layout() {
  const { user, logout, isAdmin, isEditor } = useAuth();
  const { isSuperAdmin } = useAccount();
  const navigate = useNavigate();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Filter nav items based on role
  const visibleNavItems = navItems.filter((item) => {
    if (item.to === '/rules' || item.to === '/import') {
      return isAdmin;
    }
    return true;
  });

  // Admin nav items only visible to super-admins
  const visibleAdminItems = isSuperAdmin ? adminNavItems : [];

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className={clsx(
        'bg-gray-900 text-white flex flex-col transition-all duration-300 relative',
        isCollapsed ? 'w-16' : 'w-64'
      )}>
        {/* Collapse Toggle Button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="absolute -right-3 top-6 bg-gray-800 hover:bg-gray-700 text-white p-1 rounded-full border border-gray-700 z-10"
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>

        {/* Logo */}
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <PoundSterling className="h-8 w-8 text-green-400 flex-shrink-0" />
            {!isCollapsed && (
              <h1 className="font-bold text-lg">Trading Dashboard</h1>
            )}
          </div>
        </div>

        {/* Account Switcher (V2) */}
        {!isCollapsed && (
          <div className="px-2 py-2 border-b border-gray-800">
            <AccountSwitcher />
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 p-2 overflow-y-auto">
          <ul className="space-y-1">
            {visibleNavItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  title={isCollapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
                      isActive
                        ? 'bg-gray-800 text-white'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-white',
                      isCollapsed && 'justify-center'
                    )
                  }
                >
                  <item.icon className="h-5 w-5 flex-shrink-0" />
                  {!isCollapsed && <span>{item.label}</span>}
                </NavLink>
              </li>
            ))}
          </ul>

          {/* Admin Section (Super-Admin Only) */}
          {visibleAdminItems.length > 0 && (
            <>
              {!isCollapsed && (
                <div className="mt-4 pt-4 border-t border-gray-800">
                  <p className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Administration
                  </p>
                </div>
              )}
              <ul className="space-y-1 mt-2">
                {visibleAdminItems.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      title={isCollapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        clsx(
                          'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
                          isActive
                            ? 'bg-purple-900 text-white'
                            : 'text-gray-400 hover:bg-gray-800 hover:text-white',
                          isCollapsed && 'justify-center'
                        )
                      }
                    >
                      <item.icon className="h-5 w-5 flex-shrink-0" />
                      {!isCollapsed && <span>{item.label}</span>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </>
          )}
        </nav>

        {/* User Info & Logout */}
        <div className="p-2 border-t border-gray-800">
          {user && !isCollapsed && (
            <div className="flex items-center gap-2 text-sm mb-3 px-2">
              <User className="h-4 w-4 text-gray-400 flex-shrink-0" />
              <span className="text-gray-300 truncate flex-1">{user.name || user.email}</span>
              {isAdmin && (
                <span className="px-1.5 py-0.5 text-xs bg-purple-900 text-purple-200 rounded flex-shrink-0">
                  Admin
                </span>
              )}
              {isEditor && !isAdmin && (
                <span className="px-1.5 py-0.5 text-xs bg-blue-900 text-blue-200 rounded flex-shrink-0">
                  Editor
                </span>
              )}
              {!isEditor && (
                <span className="px-1.5 py-0.5 text-xs bg-gray-700 text-gray-300 rounded flex-shrink-0">
                  Viewer
                </span>
              )}
            </div>
          )}
          <button
            onClick={handleLogout}
            title={isCollapsed ? 'Sign Out' : undefined}
            className={clsx(
              'flex items-center gap-2 w-full py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors',
              isCollapsed ? 'justify-center px-2' : 'px-3'
            )}
          >
            <LogOut className="h-4 w-4 flex-shrink-0" />
            {!isCollapsed && <span>Sign Out</span>}
          </button>
        </div>

        {/* Footer */}
        {!isCollapsed && (
          <div className="p-4 border-t border-gray-800 text-xs text-gray-500">
            <p>Bathroom Products</p>
            <p>Trading Dashboard v2.0</p>
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto h-screen bg-gray-50">
        <Outlet />
      </main>
    </div>
  );
}
