import React, { type ReactNode } from 'react';

interface ChartContainerProps {
    title: string;
    children: ReactNode;
    loading?: boolean;
    error?: string;
}

const ChartContainer: React.FC<ChartContainerProps> = ({ title, children, loading, error }) => {
    return (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col h-full">
            <h3 className="text-lg font-bold text-slate-900 mb-6">{title}</h3>

            <div className="flex-1 w-full min-h-[300px]">
                {loading ? (
                    <div className="w-full h-full flex items-center justify-center bg-slate-50 rounded-xl animate-pulse">
                        <span className="text-slate-400 text-sm">Loading chart data...</span>
                    </div>
                ) : error ? (
                    <div className="w-full h-full flex items-center justify-center bg-red-50 rounded-xl text-red-500 border border-red-100">
                        {error}
                    </div>
                ) : (
                    children
                )}
            </div>
        </div>
    );
};

export default ChartContainer;
