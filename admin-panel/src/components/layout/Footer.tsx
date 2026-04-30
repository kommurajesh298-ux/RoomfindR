import React from 'react';

const Footer: React.FC = () => {
    return (
        <footer className="flex flex-col items-center justify-between border-t border-[#d7e5fb] bg-[linear-gradient(135deg,#f7fbff_0%,#eef5ff_70%,#f6f7f1_100%)] px-8 py-6 text-center md:flex-row md:text-left">
            <p className="text-slate-500 text-sm">
                &copy; {new Date().getFullYear()} <span className="font-bold text-[#0b2d66]">RoomFindR Admin</span>. All rights reserved.
            </p>
            <div className="flex items-center gap-6 mt-4 md:mt-0">
                <a href="#" className="text-slate-400 hover:text-[#1060D0] text-xs font-medium transition-colors">Privacy Policy</a>
                <a href="#" className="text-slate-400 hover:text-[#1060D0] text-xs font-medium transition-colors">Security Guidelines</a>
                <a href="#" className="text-slate-400 hover:text-[#1060D0] text-xs font-medium transition-colors">Audit Logs</a>
            </div>
        </footer>
    );
};

export default Footer;
