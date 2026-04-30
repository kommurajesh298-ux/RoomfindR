import React, { useId, useRef, useState } from 'react';
import { FiUploadCloud, FiTrash2 } from 'react-icons/fi';
import { toast } from 'react-hot-toast';
import { propertyService } from '../../services/property.service';

interface ImageUploaderProps {
    propertyId: string;
    images: string[];
    onImagesChange: (images: string[]) => void;
    maxImages?: number;
    onUpload?: (files: File[]) => Promise<string[]>;
    readOnly?: boolean;
    hideLabel?: boolean;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({
    propertyId,
    images,
    onImagesChange,
    maxImages = 1,
    onUpload,
    readOnly = false,
    hideLabel = false
}) => {
    const inputId = useId();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (readOnly) return;
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        // Validation
        if (images.length + files.length > maxImages) {
            toast.error(`You can only upload up to ${maxImages} images`);
            return;
        }

        const validFiles: File[] = [];
        for (const file of files) {
            if (!file.type.startsWith('image/')) {
                toast.error(`${file.name} is not an image`);
                continue;
            }
            if (file.size > 5 * 1024 * 1024) { // 5MB
                toast.error(`${file.name} is too large (max 5MB)`);
                continue;
            }
            validFiles.push(file);
        }

        if (validFiles.length === 0) return;

        setUploading(true);
        try {
            let newImageUrls: string[];
            if (onUpload) {
                newImageUrls = await onUpload(validFiles);
            } else {
                newImageUrls = await propertyService.uploadPropertyImages(propertyId, validFiles);
            }

            onImagesChange([...images, ...newImageUrls]);
            toast.success(`Uploaded ${newImageUrls.length} images`);
        } catch (error: unknown) {
            console.error(error);
            toast.error("Failed to upload images");
        } finally {
            setUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleDelete = async (imageUrl: string, index: number) => {
        if (readOnly) return;
        // Optimistic update
        const newImages = images.filter((_, i) => i !== index);
        onImagesChange(newImages);
        await propertyService.deletePropertyImage(imageUrl);
    };

    return (
        <div className={`px-4 sm:px-0 ${hideLabel ? "" : "space-y-4"}`}>
            {!hideLabel && (
                <div className="flex items-center justify-between">
                    <label htmlFor={inputId} className="text-sm font-medium text-gray-700">Property Images</label>
                    <span className="text-xs text-gray-500">{images.length}/{maxImages} {maxImages === 1 ? 'photo' : 'photos'}</span>
                </div>
            )}

            {!readOnly && images.length < maxImages && (
                <div
                    onClick={() => !uploading && fileInputRef.current?.click()}
                    onTouchEnd={(e) => {
                        if (!uploading) {
                            e.preventDefault();
                            fileInputRef.current?.click();
                        }
                    }}
                    className={`
                        border-2 border-dashed rounded-xl ${hideLabel ? 'p-6' : 'p-8'}
                        flex flex-col items-center justify-center transition-all
                        min-h-[120px] touch-manipulation
                        ${uploading
                            ? 'bg-gray-50 border-gray-300 cursor-wait'
                            : 'border-gray-200 hover:border-black hover:bg-gray-50/50 cursor-pointer active:scale-[0.98]'
                        }
                    `}
                    style={{
                        WebkitTapHighlightColor: 'rgba(0, 0, 0, 0.05)',
                        pointerEvents: uploading ? 'none' : 'auto'
                    }}
                >
                    <input
                        id={inputId}
                        name={maxImages > 1 ? 'images' : 'image'}
                        type="file"
                        autoComplete="off"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        accept="image/*"
                        multiple={maxImages > 1}
                        className="hidden"
                        disabled={uploading}
                    />

                    {uploading ? (
                        <>
                            <div className="w-12 h-12 border-4 border-primary-100 border-t-primary-600 rounded-full animate-spin mb-3"></div>
                            <p className="text-gray-600 font-bold text-sm">Uploading...</p>
                        </>
                    ) : (
                        <>
                            <div className={`p-3 ${hideLabel ? 'bg-black/5 text-black' : 'bg-primary-100 text-primary-600'} rounded-full mb-3 transition-colors`}>
                                <FiUploadCloud size={hideLabel ? 20 : 24} />
                            </div>
                            <p className={`text-gray-900 font-bold ${hideLabel ? 'text-sm' : ''}`}>Click to upload or drag and drop</p>
                            <p className="text-xs text-gray-500 mt-1">SVG, PNG, JPG or GIF (max. 5MB)</p>
                        </>
                    )}
                </div>
            )}

            {images.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
                    {images.map((url, index) => (
                        <div key={`${url}-${index}`} className="relative group aspect-video rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
                            <img
                                src={url}
                                alt={`Property ${index + 1}`}
                                className="w-full h-full object-cover"
                            />

                            {!readOnly && (
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDelete(url, index);
                                        }}
                                        className="p-2 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                                        title="Delete image"
                                        type="button"
                                    >
                                        <FiTrash2 size={16} />
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
