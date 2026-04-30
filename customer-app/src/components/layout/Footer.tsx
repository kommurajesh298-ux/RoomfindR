import React from 'react';
import { Link } from 'react-router-dom';

const Footer: React.FC = () => {
    return (
        <footer className="mt-auto hidden sm:block bg-[linear-gradient(135deg,#0b2d66_0%,#1060D0_48%,#2070E0_100%)] text-white">
            <div className="container mx-auto px-4 py-8">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                    {/* About Section */}
                    <div>
                        <img src={`${import.meta.env.BASE_URL}assets/images/logos/logo-inline.png`} alt="RoomFindR" className="no-logo-badge mb-4 h-14 w-auto max-w-[210px] rounded-[18px] object-contain shadow-[0_18px_32px_rgba(11,45,102,0.22)]" />
                        <p className="text-[#eef6ff] text-sm leading-relaxed">
                            Find your perfect PG, hostel, or co-living space across India.
                        </p>
                    </div>

                    {/* Quick Links */}
                    <div>
                        <h4 className="text-sm font-semibold mb-4 text-[#F0D030]">Quick Links</h4>
                        <ul className="space-y-2 text-sm text-[#eef6ff]">
                            <li><Link to="/" className="hover:text-white hover:translate-x-1 transition-all inline-block hover:shadow-glow">Home</Link></li>
                            <li><Link to="/about" className="hover:text-white hover:translate-x-1 transition-all inline-block">About</Link></li>
                            <li><Link to="/contact" className="hover:text-white hover:translate-x-1 transition-all inline-block">Contact</Link></li>
                        </ul>
                    </div>

                    {/* Legal */}
                    <div>
                        <h4 className="text-sm font-semibold mb-4 text-[#F0D030]">Legal</h4>
                        <ul className="space-y-2 text-sm text-[#eef6ff]">
                            <li><Link to="/terms" className="hover:text-white hover:translate-x-1 transition-all inline-block">Terms of Service</Link></li>
                            <li><Link to="/privacy" className="hover:text-white hover:translate-x-1 transition-all inline-block">Privacy Policy</Link></li>
                        </ul>
                    </div>

                    {/* Contact */}
                    <div>
                        <h4 className="text-sm font-semibold mb-4 text-[#F0D030]">Contact</h4>
                        <ul className="space-y-2 text-sm text-[#eef6ff]">
                            <li className="flex items-center gap-2">
                                <span className="opacity-70">Email:</span> support@roomfindr.com
                            </li>
                            <li className="flex items-center gap-2">
                                <span className="opacity-70">Phone:</span> +91 1234567890
                            </li>
                        </ul>
                    </div>
                </div>

                <div className="border-t border-white/12 mt-8 pt-6 text-center text-sm text-[#d7e7ff]">
                    <p>&copy; {new Date().getFullYear()} RoomFindR. All rights reserved.</p>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
