import { Outlet, NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FileCheck,
  Package,
  Store,
  Truck,
  Settings,
  Upload,
  PoundSterling,
} from 'lucide-react';
import clsx from 'clsx';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/proposals', label: 'Proposals', icon: FileCheck },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/channels', label: 'Channels', icon: Store },
  { to: '/delivery-costs', label: 'Delivery Costs', icon: Truck },
  { to: '/rules', label: 'Pricing Rules', icon: Settings },
  { to: '/import', label: 'Import', icon: Upload },
];

export default function Layout() {
  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 text-white flex flex-col">
        {/* Logo */}
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <PoundSterling className="h-8 w-8 text-green-400" />
            <div>
              <h1 className="font-bold text-lg">Repricing</h1>
              <p className="text-xs text-gray-400">Price Management</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4">
          <ul className="space-y-1">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
                      isActive
                        ? 'bg-gray-800 text-white'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                    )
                  }
                >
                  <item.icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800 text-xs text-gray-500">
          <p>Bathroom Products</p>
          <p>Repricing System v1.0</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto h-screen bg-gray-50">
        <Outlet />
      </main>
    </div>
  );
}
