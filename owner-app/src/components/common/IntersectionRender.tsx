import React, { useState, useEffect, useRef, memo } from 'react';

interface IntersectionRenderProps {
    children: React.ReactNode;
    height?: string | number;
    offset?: number;
    className?: string;
}

export const IntersectionRender: React.FC<IntersectionRenderProps> = memo(({
    children,
    height = 300,
    offset = 400,
    className = ""
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsVisible(true);
                }
            },
            {
                rootMargin: `${offset}px 0px`,
                threshold: 0
            }
        );

        if (containerRef.current) {
            observer.observe(containerRef.current);
        }

        return () => observer.disconnect();
    }, [offset]);

    return (
        <div ref={containerRef} className={className} style={{ minHeight: isVisible ? 'auto' : height }}>
            {isVisible ? children : null}
        </div>
    );
});

IntersectionRender.displayName = 'IntersectionRender';
