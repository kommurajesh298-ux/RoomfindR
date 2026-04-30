import React from 'react';

const Footer: React.FC = () => {
    return (
        <footer className="bg-[linear-gradient(135deg,#f7fbff_0%,#eef5ff_70%,#f6f7f1_100%)] border-t border-[#d7e5fb] py-8 mt-auto md:mb-0 mb-16">
            <div className="container mx-auto px-4 text-center text-[#526784] text-sm">
                <div className="flex flex-wrap justify-center gap-6 mb-4">
                    <a href="#" className="hover:text-[#1060D0] transition-colors">About</a>
                    <a href="#" className="hover:text-[#1060D0] transition-colors">Terms of Service</a>
                    <a href="#" className="hover:text-[#1060D0] transition-colors">Privacy Policy</a>
                    <a href="#" className="hover:text-[#1060D0] transition-colors">Contact Support</a>
                </div>
                <p>&copy; {new Date().getFullYear()} RoomFindr. All rights reserved.</p>
            </div>
        </footer>
    );
};

export default Footer;
