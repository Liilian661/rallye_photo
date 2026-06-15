'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { IconCheck, IconError, IconLock } from '@/lib/icons';

interface User {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  plan: string;
  is_admin: number;
  email_verified: number;
  newsletter: number;
  created_at: string;
  eventCount: number;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterPlan, setFilterPlan] = useState('');

  const loadUsers = useCallback(async () => {
    try {
      const params: any = {};
      if (search) params.search = search;
      if (filterPlan) params.plan = filterPlan;
      const { data } = await api.get('/admin/users', { params });
      setUsers(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [search, filterPlan]);

  useEffect(() => {
    const timer = setTimeout(() => loadUsers(), 300);
    return () => clearTimeout(timer);
  }, [loadUsers]);

  const changePlan = async (userId: string, newPlan: string) => {
    try {
      await api.patch('/admin/users/' + userId, { plan: newPlan });
      loadUsers();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur');
    }
  };

  const toggleAdmin = async (userId: string, current: number) => {
    if (!confirm(current ? 'Retirer les droits admin ?' : 'Donner les droits admin ?')) return;
    try {
      await api.patch('/admin/users/' + userId, { is_admin: current ? 0 : 1 });
      loadUsers();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur');
    }
  };

  const deleteUser = async (userId: string, email: string) => {
    if (!confirm('Supprimer ' + email + ' et toutes ses donnees ?')) return;
    try {
      await api.delete('/admin/users/' + userId);
      loadUsers();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur');
    }
  };

  const impersonateUser = async (userId: string, name: string) => {
    if (!confirm('Se connecter en tant que ' + name + ' sur le panel ?')) return;
    try {
      const { data } = await api.post('/admin/impersonate/' + userId);
      // Open panel in new tab with impersonated tokens
      const panelUrl = process.env.NEXT_PUBLIC_PANEL_URL || 'https://panel.rallye-photo.com';
      const params = new URLSearchParams({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: JSON.stringify(data.user),
      });
      window.open(panelUrl + '/dashboard?impersonate=' + encodeURIComponent(params.toString()), '_blank');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur');
    }
  };

  return (
    <div className="fade-in">
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, marginBottom: 20 }}>
        Utilisateurs ({users.length})
      </h2>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <input
          type="text"
          className="input-field"
          placeholder="Rechercher par nom ou email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 300 }}
        />
        <select
          className="input-field"
          value={filterPlan}
          onChange={(e) => setFilterPlan(e.target.value)}
          style={{ maxWidth: 150 }}
        >
          <option value="">Tous les plans</option>
          <option value="free">Free</option>
          <option value="starter">Starter</option>
          <option value="pro">Pro</option>
        </select>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        {loading ? (
          <p style={{ padding: '2rem', color: 'var(--rp-text-muted)', textAlign: 'center' }}>Chargement...</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Utilisateur</th>
                <th>Email</th>
                <th>Plan</th>
                <th>Events</th>
                <th>Verifie</th>
                <th>Inscrit le</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%', background: 'var(--rp-secondary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0,
                      }}>
                        {u.first_name?.[0]}{u.last_name?.[0]}
                      </div>
                      <div>
                        <p style={{ fontWeight: 500, fontSize: 13 }}>
                          {u.first_name} {u.last_name}
                          {u.is_admin ? <span style={{ color: 'var(--rp-danger-text)', fontSize: 10, marginLeft: 4 }}>ADMIN</span> : ''}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--rp-text-secondary)' }}>{u.email}</td>
                  <td>
                    <select
                      value={u.plan}
                      onChange={(e) => changePlan(u.id, e.target.value)}
                      style={{
                        background: 'var(--rp-bg-input)', color: 'var(--rp-text-primary)',
                        border: '1px solid var(--rp-border)', borderRadius: 6,
                        padding: '4px 8px', fontSize: 12, cursor: 'pointer',
                      }}
                    >
                      <option value="free">Free</option>
                      <option value="starter">Starter</option>
                      <option value="pro">Pro</option>
                    </select>
                  </td>
                  <td style={{ textAlign: 'center' }}>{u.eventCount}</td>
                  <td style={{ textAlign: 'center' }}>
                    {u.email_verified ? (
                      <IconCheck size={16} color="var(--rp-success-text)" />
                    ) : (
                      <IconError size={16} color="var(--rp-danger-text)" />
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--rp-text-muted)' }}>
                    {new Date(u.created_at).toLocaleDateString('fr-FR')}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn-ghost"
                        onClick={() => impersonateUser(u.id, u.first_name + ' ' + u.last_name)}
                        style={{ fontSize: 11, padding: '3px 8px', color: 'var(--rp-secondary-text)' }}
                        title="Se connecter en tant que cet utilisateur"
                      >
                        Connexion
                      </button>
                      <button
                        className="btn-ghost"
                        onClick={() => toggleAdmin(u.id, u.is_admin)}
                        style={{ fontSize: 11 }}
                        title={u.is_admin ? 'Retirer admin' : 'Rendre admin'}
                      >
                        <IconLock size={14} color={u.is_admin ? 'var(--rp-warning-text)' : 'var(--rp-text-muted)'} />
                      </button>
                      <button
                        className="btn-danger"
                        onClick={() => deleteUser(u.id, u.email)}
                        style={{ fontSize: 11, padding: '3px 10px' }}
                      >
                        Suppr
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}