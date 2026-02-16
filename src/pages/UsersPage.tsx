import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pagination, Skeleton } from 'tsp-form';
import { apiClient } from '../lib/api';

interface VUser {
  id: number;
  username: string;
  role_code: string;
  role_scope: string;
  holding_id: number | null;
  holding_code: string | null;
  holding_name: string | null;
  company_id: number | null;
  company_code: string | null;
  company_name: string | null;
  branch_id: number | null;
  branch_code: string | null;
  branch_name: string | null;
  is_active: boolean;
  must_change_password: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

const PAGE_SIZE = 15;

export function UsersPage() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<VUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const fetchUsers = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiClient.get<VUser[]>('/v_users');
        setUsers(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('common.error'));
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, [t]);

  const totalPages = Math.ceil(users.length / PAGE_SIZE);
  const paginatedUsers = users.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  return (
    <div className="page-content p-6 min-w-0">
      <h1 className="text-xl font-bold mb-6">{t('users.title')}</h1>

      {/* Loading state */}
      {loading && (
        <div className="border border-line bg-surface rounded-lg divide-y divide-line">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-4 py-3 flex items-center gap-3">
              <Skeleton variant="text" width="30%" height={16} />
              <Skeleton variant="text" width="20%" height={16} />
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="border border-line bg-surface p-6 rounded-lg text-center">
          <div className="text-danger mb-4">{error}</div>
          <button
            className="px-4 py-2 text-sm border border-line rounded-lg hover:bg-surface-hover transition-colors"
            onClick={() => window.location.reload()}
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      {/* User list */}
      {!loading && !error && (
        <>
          {paginatedUsers.length === 0 ? (
            <div className="border border-line bg-surface p-8 rounded-lg text-center text-control-label">
              {t('users.empty')}
            </div>
          ) : (
            <div className="border border-line bg-surface rounded-lg divide-y divide-line">
              {paginatedUsers.map((user) => (
                <div key={user.id} className="px-4 py-3 hover:bg-surface-hover transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{user.username}</span>
                    <span className={`shrink-0 w-2 h-2 rounded-full ${user.is_active ? 'bg-success' : 'bg-danger'}`} />
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-control-label">
                    <span className="capitalize">{user.role_code}</span>
                    <span className="capitalize">{user.role_scope}</span>
                    {user.company_name && <span>{user.company_name}</span>}
                    {user.branch_name && <span>{user.branch_name}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex justify-center">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
