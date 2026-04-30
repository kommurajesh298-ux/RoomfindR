import React, { useState, useEffect } from 'react';
import Modal from '../common/Modal';
import { propertyService } from '../../services/property.service';
import { ratingService, type AdminPropertyRating } from '../../services/rating.service';
import { FiFlag, FiClock, FiUser, FiCheck, FiTrash2, FiStar } from 'react-icons/fi';
import Badge from '../common/Badge';
import { format } from 'date-fns';
import { toast } from 'react-hot-toast';

interface ReportsModalProps {
    isOpen: boolean;
    onClose: () => void;
    propertyId: string;
    propertyTitle: string;
}

const ReportsModal: React.FC<ReportsModalProps> = ({ isOpen, onClose, propertyId, propertyTitle }) => {
    const [reports, setReports] = useState<Record<string, unknown>[]>([]);
    const [ratings, setRatings] = useState<AdminPropertyRating[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletingRatingId, setDeletingRatingId] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen && propertyId) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setLoading(true);
            Promise.all([
                propertyService.getPropertyReports(propertyId),
                ratingService.getPropertyRatings(propertyId),
            ]).then(([reportData, ratingData]) => {
                setReports(reportData);
                setRatings(ratingData);
                setLoading(false);
            }).catch((error) => {
                console.error('Failed to load moderation details:', error);
                setLoading(false);
            });
        }
    }, [isOpen, propertyId]);

    const handleDeleteRating = async (ratingId: string) => {
        if (!window.confirm('Delete this review from the property?')) {
            return;
        }

        setDeletingRatingId(ratingId);
        try {
            await ratingService.deleteRating(ratingId);
            setRatings((current) => current.filter((rating) => rating.id !== ratingId));
            toast.success('Review removed successfully.');
        } catch (error) {
            console.error('Failed to delete review:', error);
            toast.error('Failed to delete review.');
        } finally {
            setDeletingRatingId(null);
        }
    };

    const renderStars = (rating: number) => (
        <div className="flex items-center gap-1 text-orange-500">
            {Array.from({ length: 5 }, (_, index) => (
                <FiStar
                    key={`${rating}-${index}`}
                    className={index < Math.round(rating) ? 'fill-current' : 'text-slate-300'}
                    size={14}
                />
            ))}
        </div>
    );

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Property Details: ${propertyTitle}`} maxWidth="max-w-2xl">
            <div className="space-y-4">
                {loading ? (
                    <div className="space-y-4">
                        {[1, 2].map(i => <div key={i} className="h-24 bg-slate-100 rounded-2xl animate-pulse"></div>)}
                    </div>
                ) : (
                    <>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-900">Reports</h3>
                                <Badge variant={reports.length > 0 ? 'danger' : 'neutral'}>{reports.length}</Badge>
                            </div>

                            {reports.length > 0 ? reports.map((report) => (
                                <div key={report.id as string} className="bg-slate-50 border border-slate-100 rounded-2xl p-5">
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <FiFlag className="text-rose-500" />
                                            <span className="font-bold text-slate-900">{(report.reason as string) || 'General Issue'}</span>
                                        </div>
                                        <Badge variant="danger">Reported</Badge>
                                    </div>

                                    <p className="text-sm text-slate-600 mb-4 leading-relaxed">
                                        "{(report.description as string) || 'No additional details provided.'}"
                                    </p>

                                    <div className="flex items-center justify-between pt-4 border-t border-slate-200/50 text-[11px] text-slate-400 font-bold uppercase tracking-widest">
                                        <div className="flex items-center gap-4">
                                            <span className="flex items-center gap-1"><FiUser /> User ID: {((report.userId as string) || '').slice(0, 8)}</span>
                                            <span className="flex items-center gap-1"><FiClock /> {report.timestamp && (report.timestamp as { seconds: number }).seconds ? format(new Date((report.timestamp as { seconds: number }).seconds * 1000), 'PPp') : 'N/A'}</span>
                                        </div>
                                        <button className="text-blue-600 hover:text-blue-700 flex items-center gap-1">
                                            <FiCheck /> Mark Resolved
                                        </button>
                                    </div>
                                </div>
                            )) : (
                                <div className="text-center py-10 rounded-2xl border border-dashed border-slate-200">
                                    <FiFlag size={32} className="mx-auto text-slate-200 mb-3" />
                                    <p className="text-slate-500 font-medium">No active reports for this property.</p>
                                </div>
                            )}
                        </div>

                        <div className="space-y-4 pt-4 border-t border-slate-200">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-900">Ratings & Reviews</h3>
                                <Badge variant={ratings.length > 0 ? 'warning' : 'neutral'}>{ratings.length}</Badge>
                            </div>

                            {ratings.length > 0 ? ratings.map((rating) => (
                                <div key={rating.id} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <p className="font-bold text-slate-900">{rating.reviewerName}</p>
                                            <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                                                {format(new Date(rating.createdAt), 'PPp')}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            {renderStars(rating.rating)}
                                            <p className="mt-1 text-xs font-black text-orange-600">{rating.rating.toFixed(1)}</p>
                                        </div>
                                    </div>

                                    <p className="mt-4 text-sm leading-6 text-slate-600">
                                        {rating.review || 'Guest shared a star rating without written feedback.'}
                                    </p>

                                    <div className="mt-4 flex justify-end">
                                        <button
                                            onClick={() => handleDeleteRating(rating.id)}
                                            disabled={deletingRatingId === rating.id}
                                            className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-rose-600 transition-all hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            <FiTrash2 size={14} />
                                            {deletingRatingId === rating.id ? 'Deleting...' : 'Delete Review'}
                                        </button>
                                    </div>
                                </div>
                            )) : (
                                <div className="text-center py-10 rounded-2xl border border-dashed border-slate-200">
                                    <FiStar size={32} className="mx-auto text-slate-200 mb-3" />
                                    <p className="text-slate-500 font-medium">No ratings found for this property.</p>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
};

export default ReportsModal;
