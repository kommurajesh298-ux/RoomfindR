import React, { useState, useEffect } from 'react';
import { userService } from '../services/user.service';
import type { UserData } from '../services/user.service';
import { toast } from 'react-hot-toast';
import { FiSearch, FiUser } from 'react-icons/fi';

const Customers: React.FC = () => {
    const [customers, setCustomers] = useState<UserData[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        const fetchCustomers = async () => {
            setLoading(true);
            try {
                const users = await userService.getAllUsers();
                const customerUsers = users.filter(u => u.role === 'customer');
                setCustomers(customerUsers);
            } catch (error) {
                console.error("Fetch customers error details:", error);
                toast.error("Failed to load customers. Check console for details.");
            } finally {
                setLoading(false);
            }
        };

        fetchCustomers();
    }, []);

    const filteredCustomers = customers.filter(c =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.email.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-[var(--rf-color-text)] mb-1">Customers</h1>
                    <p className="text-[var(--rf-color-text-secondary)]">View and manage registered customers</p>
                </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="relative w-full md:w-96 group">
                    <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                    <input
                        type="text"
                        name="customerSearch"
                        placeholder="Search by name or email..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-100 rounded-xl py-2.5 pl-11 pr-4 outline-none focus:bg-white focus:border-orange-500/50 transition-all text-sm"
                    />
                </div>
            </div>

            {loading ? (
                <div className="text-center py-10">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-slate-900 mx-auto"></div>
                </div>
            ) : filteredCustomers.length > 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-slate-600">
                            <thead className="bg-slate-50 text-slate-900 font-bold border-b border-slate-200 uppercase text-xs tracking-wider">
                                <tr>
                                    <th className="px-6 py-4">Name</th>
                                    <th className="px-6 py-4">Email</th>
                                    <th className="px-6 py-4">Phone</th>
                                    <th className="px-6 py-4">Joined</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredCustomers.map((customer) => (
                                    <tr key={customer.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-6 py-4 font-medium text-slate-900 flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                                                {customer.name.charAt(0).toUpperCase()}
                                            </div>
                                            {customer.name}
                                        </td>
                                        <td className="px-6 py-4">{customer.email}</td>
                                        <td className="px-6 py-4">{customer.phone || 'N/A'}</td>
                                        <td className="px-6 py-4">{customer.created_at ? new Date(customer.created_at).toLocaleDateString() : 'N/A'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="bg-white border border-slate-200 rounded-3xl p-16 text-center">
                    <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6 text-slate-300">
                        <FiUser size={40} />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">No Customers Found</h3>
                    <p className="text-slate-500">No customer accounts found matching your search.</p>
                </div>
            )}
        </div>
    );
};

export default Customers;

