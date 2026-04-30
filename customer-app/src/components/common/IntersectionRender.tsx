import React, { useState, useEffect, useRef, memo } from 'react';

interface IntersectionRenderProps {
    children: React.ReactNode;
    height?: string | number;
    offset?: number;
    once?: boolean;
    className?: string;
}

export const IntersectionRender: React.FC<IntersectionRenderProps> = memo(({
    children,
    height = 400,
    offset = 500,
    once = true,
    className = 'h-full'
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const [hasRendered, setHasRendered] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsVisible(true);
                    setHasRendered(true);
                    if (once) {
                        observer.disconnect();
                    }
                    return;
                }

                if (!once) {
                    setIsVisible(false);
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
    }, [offset, once]);

    const shouldRender = once ? hasRendered || isVisible : isVisible;

    return (
        <div ref={containerRef} style={{ minHeight: shouldRender ? 'auto' : height }} className={className}>
            {shouldRender ? children : null}
        </div>
    );
});

IntersectionRender.displayName = 'IntersectionRender';
