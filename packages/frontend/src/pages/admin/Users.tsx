import { useState, useEffect } from 'react';
import { User as UserIcon, Plus, Edit2, Trash2, Shield, Check, X, Mail, UserCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usersApi, accountsApi, User, Account } from '../../api';
import Loading from '../../components/Loading';
import ErrorMessage from '../../components/ErrorMessage';
import Button from '../../components/Button';

interface UserFormData {
  email: string;
  givenName: string;
  familyName: string;
  groups: string[];
  allowedAccounts: string[];
  defaultAccount: string;
  temporaryPassword: string;
}

const AVAILABLE_GROUPS = ['super-admin', 'admin', 'editor', 'viewer'];

/**
 * Admin page for managing users
 * Super-admin only
 */
export default function UsersAdmin() {
  const { isAdmin } = useAuth();

  const [users, setUsers] = useState<User[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState<UserFormData>({
    email: '',
    givenName: '',
    familyName: '',
    groups: ['viewer'],
    allowedAccounts: [],
    defaultAccount: '',
    temporaryPassword: '',
  });

  // Load users and accounts
  useEffect(() => {
    async function loadData() {
      try {
        const [usersResponse, accountsResponse] = await Promise.all([
          usersApi.list(),
          accountsApi.list(),
        ]);
        setUsers(usersResponse.items || []);
        setAccounts(accountsResponse.items || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, []);

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      if (editingUser) {
        // Update existing user
        await usersApi.update(editingUser.email, {
          name: `${formData.givenName} ${formData.familyName}`,
          groups: formData.groups,
          allowedAccounts: formData.allowedAccounts,
          defaultAccount: formData.defaultAccount || undefined,
        });
      } else {
        // Create new user
        await usersApi.create({
          email: formData.email,
          givenName: formData.givenName,
          familyName: formData.familyName,
          groups: formData.groups,
          allowedAccounts: formData.allowedAccounts,
          defaultAccount: formData.defaultAccount || undefined,
          temporaryPassword: formData.temporaryPassword || undefined,
        });
      }

      // Reload users
      const response = await usersApi.list();
      setUsers(response.items || []);

      // Reset form
      setShowCreateForm(false);
      setEditingUser(null);
      setFormData({
        email: '',
        givenName: '',
        familyName: '',
        groups: ['viewer'],
        allowedAccounts: [],
        defaultAccount: '',
        temporaryPassword: '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save user');
    }
  };

  // Handle delete (disable)
  const handleDelete = async (email: string) => {
    if (!confirm('Are you sure you want to disable this user?')) return;

    try {
      await usersApi.delete(email);
      const response = await usersApi.list();
      setUsers(response.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable user');
    }
  };

  // Handle enable user
  const handleEnable = async (email: string) => {
    try {
      await usersApi.enable(email);
      const response = await usersApi.list();
      setUsers(response.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable user');
    }
  };

  // Handle resend invitation
  const handleResendInvitation = async (email: string) => {
    if (!confirm('This will enable the user and send them a new invitation email with login details. Continue?')) return;

    try {
      await usersApi.resendInvitation(email);
      const response = await usersApi.list();
      setUsers(response.items || []);
      alert('Invitation email sent successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invitation');
    }
  };

  // Start editing
  const handleEdit = (user: User) => {
    setEditingUser(user);
    // Parse name into first/last (name is stored as "First Last")
    const nameParts = (user.name || '').split(' ');
    const givenName = nameParts[0] || '';
    const familyName = nameParts.slice(1).join(' ') || '';
    setFormData({
      email: user.email,
      givenName,
      familyName,
      groups: user.groups,
      allowedAccounts: user.allowedAccounts,
      defaultAccount: user.defaultAccount || '',
      temporaryPassword: '',
    });
    setShowCreateForm(true);
  };

  // Toggle group membership
  const toggleGroup = (group: string) => {
    if (formData.groups.includes(group)) {
      setFormData({
        ...formData,
        groups: formData.groups.filter((g) => g !== group),
      });
    } else {
      setFormData({
        ...formData,
        groups: [...formData.groups, group],
      });
    }
  };

  // Toggle account access
  const toggleAccount = (accountId: string) => {
    if (formData.allowedAccounts.includes(accountId)) {
      setFormData({
        ...formData,
        allowedAccounts: formData.allowedAccounts.filter((a) => a !== accountId),
        defaultAccount:
          formData.defaultAccount === accountId ? '' : formData.defaultAccount,
      });
    } else {
      setFormData({
        ...formData,
        allowedAccounts: [...formData.allowedAccounts, accountId],
      });
    }
  };

  // Get role badge color
  const getRoleBadgeColor = (group: string) => {
    switch (group) {
      case 'super-admin':
        return 'bg-purple-100 text-purple-800';
      case 'admin':
        return 'bg-blue-100 text-blue-800';
      case 'editor':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-6">
        <ErrorMessage message="Access denied. Super-admin role required." />
      </div>
    );
  }

  if (isLoading) {
    return <Loading />;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-600 mt-1">Manage users and their account access</p>
        </div>
        <Button
          onClick={() => {
            setEditingUser(null);
            setFormData({
              email: '',
              givenName: '',
              familyName: '',
              groups: ['viewer'],
              allowedAccounts: [],
              defaultAccount: '',
              temporaryPassword: '',
            });
            setShowCreateForm(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add User
        </Button>
      </div>

      {error && <ErrorMessage message={error} className="mb-4" />}

      {/* User Form Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-white">
              <h2 className="text-lg font-semibold">
                {editingUser ? 'Edit User' : 'Create User'}
              </h2>
              <button
                onClick={() => setShowCreateForm(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              {!editingUser && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="user@example.com"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    First Name
                  </label>
                  <input
                    type="text"
                    value={formData.givenName}
                    onChange={(e) =>
                      setFormData({ ...formData, givenName: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={formData.familyName}
                    onChange={(e) =>
                      setFormData({ ...formData, familyName: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>

              {!editingUser && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Temporary Password (optional)
                  </label>
                  <input
                    type="password"
                    value={formData.temporaryPassword}
                    onChange={(e) =>
                      setFormData({ ...formData, temporaryPassword: e.target.value })
                    }
                    placeholder="Leave blank for auto-generated"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              <div className="border-t pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Shield className="h-4 w-4 inline mr-1" />
                  Roles
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_GROUPS.map((group) => (
                    <button
                      key={group}
                      type="button"
                      onClick={() => toggleGroup(group)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                        formData.groups.includes(group)
                          ? getRoleBadgeColor(group)
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {formData.groups.includes(group) && (
                        <Check className="h-3 w-3 inline mr-1" />
                      )}
                      {group}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  super-admin: Full access to all accounts and settings
                </p>
              </div>

              <div className="border-t pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Account Access
                </label>
                {accounts.length === 0 ? (
                  <p className="text-gray-500 text-sm">No accounts available</p>
                ) : (
                  <div className="space-y-2">
                    {accounts.map((account) => (
                      <div
                        key={account.accountId}
                        className="flex items-center justify-between p-2 border rounded-lg"
                      >
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.allowedAccounts.includes(account.accountId)}
                            onChange={() => toggleAccount(account.accountId)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>{account.name}</span>
                        </label>
                        {formData.allowedAccounts.includes(account.accountId) && (
                          <label className="flex items-center gap-1 text-sm text-gray-500">
                            <input
                              type="radio"
                              name="defaultAccount"
                              checked={formData.defaultAccount === account.accountId}
                              onChange={() =>
                                setFormData({
                                  ...formData,
                                  defaultAccount: account.accountId,
                                })
                              }
                              className="border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            Default
                          </label>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowCreateForm(false)}
                >
                  Cancel
                </Button>
                <Button type="submit">
                  {editingUser ? 'Save Changes' : 'Create User'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                User
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Roles
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Accounts
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {users.map((user) => (
              <tr key={user.userId} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <UserIcon className="h-5 w-5 text-gray-400 mr-3" />
                    <div>
                      <div className="font-medium text-gray-900">
                        {user.name}
                      </div>
                      <div className="text-sm text-gray-500">{user.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      user.enabled
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {user.enabled ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex flex-wrap gap-1">
                    {user.groups.map((group) => (
                      <span
                        key={group}
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeColor(
                          group
                        )}`}
                      >
                        {group}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-500">
                    {user.allowedAccounts.length > 0 ? (
                      <span>
                        {user.allowedAccounts.length} account
                        {user.allowedAccounts.length !== 1 ? 's' : ''}
                      </span>
                    ) : (
                      <span className="text-gray-400">None</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button
                    onClick={() => handleEdit(user)}
                    className="text-blue-600 hover:text-blue-900 mr-3"
                    title="Edit user"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleResendInvitation(user.email)}
                    className="text-green-600 hover:text-green-900 mr-3"
                    title="Resend invitation email"
                  >
                    <Mail className="h-4 w-4" />
                  </button>
                  {user.enabled ? (
                    <button
                      onClick={() => handleDelete(user.email)}
                      className="text-red-600 hover:text-red-900"
                      title="Disable user"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleEnable(user.email)}
                      className="text-green-600 hover:text-green-900"
                      title="Enable user"
                    >
                      <UserCheck className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {users.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No users found. Click "Add User" to create one.
          </div>
        )}
      </div>
    </div>
  );
}
