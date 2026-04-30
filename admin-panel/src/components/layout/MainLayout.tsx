import React, { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import Footer from './Footer';

const MainLayout: React.FC = () => {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const location = useLocation();

    // Close mobile sidebar on route change
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMobileSidebarOpen(false);
    }, [location.pathname]);

    return (
        <div className="min-h-screen bg-slate-50 flex overflow-hidden">
            {/* Sidebar */}
            <Sidebar
                collapsed={sidebarCollapsed}
                toggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)}
                mobileOpen={mobileSidebarOpen}
                setMobileOpen={setMobileSidebarOpen}
                pendingOwnersCount={0} // Placeholder, can be lifted to Context later
            />

            {/* Mobile Sidebar Backdrop */}
            {mobileSidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm"
                    onClick={() => setMobileSidebarOpen(false)}
                />
            )}

            {/* Main Content Area */}
            <div className={`flex h-screen min-w-0 w-full flex-1 flex-col transition-all duration-300 ${sidebarCollapsed
                ? 'md:ml-24 md:w-[calc(100%-6rem)]'
                : 'md:ml-72 md:w-[calc(100%-18rem)]'
                } ml-0`}>

                <TopBar
                    onMenuClick={() => setMobileSidebarOpen(true)}
                />

                {/* Scrollable Content */}
                <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-50 p-4 md:p-8 flex flex-col">
                    <div className="flex-1">
                        <Outlet />
                    </div>
                    <div className="mt-auto">
                        <Footer />
                    </div>
                </main>
            </div>
        </div>
    );
};

export default MainLayout;
