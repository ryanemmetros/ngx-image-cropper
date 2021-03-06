import {
    Component, ElementRef, EventEmitter, HostBinding, HostListener, Input, OnChanges, Output,
    SimpleChanges, ChangeDetectorRef, ChangeDetectionStrategy, NgZone, ViewChild, QueryList, ViewChildren
} from '@angular/core';
import { DomSanitizer, SafeUrl, SafeStyle } from '@angular/platform-browser';
import { MoveStart, Dimensions, CropperPosition, ImageCroppedEvent, ElementPosition } from '../interfaces';
import { resetExifOrientation, transformBase64BasedOnExifRotation, transformBase64BlobBasedOnExifRotation } from '../utils/exif.utils';
import { resizeCanvas } from '../utils/resize.utils';

export type OutputType = 'base64' | 'file' | 'both';

@Component({
    selector: 'image-cropper',
    templateUrl: './image-cropper.component.html',
    styleUrls: ['./image-cropper.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ImageCropperComponent implements OnChanges {
    private originalImage: any;
    private originalBase64: string;
    private moveStart: MoveStart;
    private originalSize: Dimensions;
    private setImageMaxSizeRetries = 0;
    private cropperScaledMinWidth = 20;
    private cropperScaledMinHeight = 20;
    private cropperScaledMaxHeight:number = 0;
    
    private pinchActive: boolean = false
    private pinchZoomInitialScale: number = 1;
    private pinchInitialCenter: any = null;

    private imageScale = 1;
    private imageTranslateX = 0;
    private imageTranslateY = 0;
    private EXIF = (window as any).EXIF;
    private imageRotate = 0;
    get imageTransform(): SafeStyle {
        return this.sanitizer.bypassSecurityTrustStyle(`scale(${this.imageScale}) translate(${this.imageTranslateX}px, ${this.imageTranslateY}px) rotate(${this.imageRotate}deg)`);
    }
    
    maxSize: Dimensions;

    safeImgDataUrl: SafeUrl | string;
    resetImgDataUrl: string;
    marginLeft: SafeStyle | string = '0px';
    imageVisible = false;

    @ViewChild('zoomWindow') zoomWindow: ElementRef;
    @ViewChild('sourceImage') sourceImage: ElementRef;
    @ViewChildren('square') touchTargets:QueryList<ElementRef>;

    @Input()
    set imageFileChanged(file: File) {
        this.initCropper();
        if (file) {
            this.loadImageFile(file);
        }
    }

    @Input()
    set imageChangedEvent(event: any) {
        this.initCropper();
        if (event && event.target && event.target.files && event.target.files.length > 0) {
            this.loadImageFile(event.target.files[0]);
        }
    }

    @Input()
    set imageBase64(imageBase64: string) {
        this.initCropper();
        this.loadBase64Image(imageBase64);
    }

    @Input() format: 'png' | 'jpeg' | 'bmp' | 'webp' | 'ico' = 'png';
    @Input() outputType: OutputType = 'both';
    @Input() maintainAspectRatio = true;
    @Input() aspectRatio = 1;
    @Input() resizeToWidth = 0;
    @Input() cropperMinWidth = 0;
    @Input() cropperMinHeight = 0;
    @Input() cropperMinAspectRatio = 0;
    @Input() cropperMaxAspectRatio = 0;
    @Input() roundCropper = false;
    @Input() onlyScaleDown = false;
    @Input() imageQuality = 92;
    @Input() autoCrop = true;
    @Input() cropper: CropperPosition = {
        x1: -100,
        y1: -100,
        x2: 10000,
        y2: 10000
    };
    @HostBinding('style.text-align')
    @Input() alignImage: 'left' | 'center' = 'center';


    @Output() startCropImage = new EventEmitter<void>();
    @Output() imageCropped = new EventEmitter<ImageCroppedEvent>();
    @Output() imageCroppedBase64 = new EventEmitter<string>();
    @Output() imageCroppedFile = new EventEmitter<Blob>();
    @Output() imageLoaded = new EventEmitter<void>();
    @Output() cropperReady = new EventEmitter<void>();
    @Output() loadImageFailed = new EventEmitter<void>();

    constructor(private sanitizer: DomSanitizer,
                private cd: ChangeDetectorRef,
                private zone: NgZone) {
        this.initCropper();
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes.cropper) {
            this.setMaxSize();
            this.setCropperScaledMinSize();
            this.checkCropperPosition(false);
            this.doAutoCrop();
            this.cd.markForCheck();
        }
        if (changes.aspectRatio && this.imageVisible) {
            this.resetCropperPosition();
        }
    }

    private initCropper(): void {
        this.imageVisible = false;
        this.originalImage = null;
        this.safeImgDataUrl = 'data:image/png;base64,iVBORw0KGg'
            + 'oAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQYV2NgAAIAAAU'
            + 'AAarVyFEAAAAASUVORK5CYII=';
        this.moveStart = {
            active: false,
            type: null,
            position: null,
            x1: 0,
            y1: 0,
            x2: 0,
            y2: 0,
            clientX: 0,
            clientY: 0
        };
        this.maxSize = {
            width: 0,
            height: 0
        };
        this.originalSize = {
            width: 0,
            height: 0
        };
        this.cropper.x1 = -100;
        this.cropper.y1 = -100;
        this.cropper.x2 = 10000;
        this.cropper.y2 = 10000;
    }

    private loadImageFile(file: File): void {
        const fileReader = new FileReader();
        fileReader.onload = (event: any) => {
            const imageType = file.type;
            if (this.isValidImageType(imageType)) {
                if (this.EXIF !== undefined){
                    var cropper = this;
                    this.EXIF.getData(file, function(imageData: any){                        
                        transformBase64BasedOnExifRotation(event.target.result, this.exifdata && this.exifdata.Orientation ? this.exifdata.Orientation: 0)
                        .then((resultBase64: string) => cropper.loadBase64Image(resultBase64))
                        .catch(() => cropper.loadImageFailed.emit());
                    });
                } else {
                    resetExifOrientation(event.target.result)
                        .then((resultBase64: string) => this.loadBase64Image(resultBase64))
                        .catch(() => this.loadImageFailed.emit());
                }
            } else {
                this.loadImageFailed.emit();
            }
        };
        fileReader.readAsDataURL(file);
    }

    private isValidImageType(type: string): boolean {
        return /image\/(png|jpg|jpeg|bmp|gif|tiff)/.test(type);
    }

    private loadBase64Image(imageBase64: string): void {
        this.originalBase64 = imageBase64;
        this.safeImgDataUrl = this.sanitizer.bypassSecurityTrustResourceUrl(imageBase64);

        if (!this.resetImgDataUrl) {
            this.resetImgDataUrl = imageBase64;
        }

        this.originalImage = new Image();
        this.originalImage.crossOrigin = "anonymous";
        this.originalImage.onload = () => {
            this.originalSize.width = this.originalImage.width;
            this.originalSize.height = this.originalImage.height;
            
            this.cd.markForCheck();
        };
        this.originalImage.src = imageBase64;
    }

    imageLoadedInView(): void {
        if (this.originalImage != null) {
            this.imageLoaded.emit();
            this.setImageMaxSizeRetries = 0;
            setTimeout(() => this.checkImageMaxSizeRecursively());
        }
    }

    private checkImageMaxSizeRecursively(): void {
        if (this.setImageMaxSizeRetries > 40) {
            this.loadImageFailed.emit();
        } else if (this.sourceImage && this.sourceImage.nativeElement && this.sourceImage.nativeElement.offsetWidth > 0) {
            this.setMaxSize();
            this.setCropperScaledMinSize();
            this.resetCropperPosition();
            this.cropperReady.emit();
            this.cd.markForCheck();
        } else {
            this.setImageMaxSizeRetries++;
            setTimeout(() => {
                this.checkImageMaxSizeRecursively();
            }, 50);
        }
    }

    @HostListener('window:resize')
    onResize(): void {
        this.resizeCropperPosition();
        this.setMaxSize();
        this.setCropperScaledMinSize();
    }

    rotateLeft() {
        this.transformImageToBlob(8);
    }

    rotateRight() {
        this.transformImageToBlob(6);
    }

    flipHorizontal() {
        this.transformBase64(2);
    }

    flipVertical() {
        this.transformBase64(4);
    }

    transformImageToBlob(exif: number) {
        transformBase64BlobBasedOnExifRotation(this.originalBase64, exif).then((imageBlob: Blob) => {
            const url = window.URL.createObjectURL(imageBlob);
            this.loadBase64Image(url);
        });
    }

    onPinch(evt: any) {
        if (this.pinchActive) {

            if (this.pinchInitialCenter === null) {
                this.pinchInitialCenter = { x: evt.center.x, y: evt.center.y}
            }

            // do the actual scaling of the image, call function to scale
            this.zoomImage(true, this.pinchZoomInitialScale * evt.scale, this.pinchInitialCenter.x, this.pinchInitialCenter.y);
        }
    }

    onPinchStart(evt: any) {
        // keep track of if we are in a pinch currently
        this.pinchActive = true;

        // set my image scale in variable before we apply pinch scaling (needed for further pinch calcs)
        this.pinchZoomInitialScale = this.imageScale;
    }
  
    onPinchEnd(evt: any) {
        // set that we have ended pinching
        this.pinchActive = false;
        this.pinchZoomInitialScale = 1;
        this.pinchInitialCenter = null;
    }

    onPan(evt: any) {
        this.pan(evt.deltaX/10, evt.evt.deltaY/10)
    }

    private pan(deltaX: number, deltaY: number) {
        const imageOffset = this.getOffsetInfo(this.sourceImage);
        const zoomWindowOffset = this.getOffsetInfo(this.zoomWindow);

        this.imageTranslateX += (this.getXTranslation(deltaX, zoomWindowOffset, imageOffset) / this.imageScale);
        this.imageTranslateY += (this.getYTranslation(deltaY, zoomWindowOffset, imageOffset) / this.imageScale);  
    }

    reset() {
        this.pinchZoomInitialScale = 1;
        this.pinchActive = false;
        this.pinchInitialCenter = null;
        this.imageScale = 1;
        this.imageTranslateX = 0;
        this.imageTranslateY = 0;

        if (this.resetImgDataUrl) {
            this.loadBase64Image(this.resetImgDataUrl);
        }
    }

    private transformBase64(exifOrientation: number): void {
        if (this.originalBase64) {
            transformBase64BasedOnExifRotation(this.originalBase64, exifOrientation)
                .then((rotatedBase64: string) => {
                    this.loadBase64Image(rotatedBase64)
                });
        }
    }

    private resizeCropperPosition(): void {
        const sourceImageElement = this.sourceImage.nativeElement;
        if (this.maxSize.width !== sourceImageElement.offsetWidth || this.maxSize.height !== sourceImageElement.offsetHeight) {
            this.cropper.x1 = this.cropper.x1 * sourceImageElement.offsetWidth / this.maxSize.width;
            this.cropper.x2 = this.cropper.x2 * sourceImageElement.offsetWidth / this.maxSize.width;
            this.cropper.y1 = this.cropper.y1 * sourceImageElement.offsetHeight / this.maxSize.height;
            this.cropper.y2 = this.cropper.y2 * sourceImageElement.offsetHeight / this.maxSize.height;
        }
    }

    private resetCropperPosition(): void {
        const sourceImageElement = this.sourceImage.nativeElement;
        const width = sourceImageElement.offsetWidth;
        const height = sourceImageElement.offsetHeight;
        if (!this.maintainAspectRatio) {
            this.cropper.x1 = 0;
            this.cropper.x2 = width;
            this.cropper.y1 = 0;
            this.cropper.y2 = height;
        } else if (sourceImageElement.offsetWidth / this.aspectRatio < sourceImageElement.offsetHeight) {
            this.cropper.x1 = 0;
            this.cropper.x2 = width;
            const cropperHeight = width / this.aspectRatio;
            this.cropper.y1 = (sourceImageElement.offsetHeight - cropperHeight) / 2;
            this.cropper.y2 = this.cropper.y1 + cropperHeight;
        } else {
            this.cropper.y1 = 0;
            this.cropper.y2 = height;
            const cropperWidth = height * this.aspectRatio;
            this.cropper.x1 = (width - cropperWidth) / 2;
            this.cropper.x2 = this.cropper.x1 + cropperWidth;
        }
        this.doAutoCrop();
        this.imageVisible = true;
    }

    startMove(event: any, moveType: string, position: string | null = null): void {
        event.preventDefault();

        if (moveType === 'move' && event.ctrlKey) {
            moveType = 'pan';
        }

        this.moveStart = {
            active: true,
            type: moveType,
            position: position,
            clientX: this.getClientX(event, true),
            clientY: this.getClientY(event, true),
            ...this.cropper
        };
    }

    @HostListener('document:mousemove', ['$event'])
    @HostListener('document:touchmove', ['$event'])
    moveImg(event: any): void {
        if (this.moveStart.active) {
            event.stopPropagation();
            event.preventDefault();
            if (this.moveStart.type === 'move') {
                this.move(event);
                this.checkCropperPosition(true);
            } else if (this.moveStart.type === 'resize') {
                this.resize(event);
                this.checkCropperPosition(false);
            } else if (this.moveStart.type === 'pan') {
                this.pan(event.movementX, event.movementY);
            }
            this.cd.detectChanges();
        }
    }

    private setMaxSize(): void {
        const sourceImageElement = this.sourceImage.nativeElement;
        this.maxSize.width = sourceImageElement.offsetWidth;
        this.maxSize.height = sourceImageElement.offsetHeight;
        this.marginLeft = this.sanitizer.bypassSecurityTrustStyle('calc(50% - ' + this.maxSize.width / 2 + 'px)');
    }

    private setCropperScaledMinSize(): void {
        // calc min width/height for the large crop target which will override the passed in px if it is larger
        let largestWidthTouchTarget = 0;
        let largestHeightTouchTarget = 0;

        this.touchTargets.forEach((target) => {
            const width = target.nativeElement.offsetWidth;
            const height = target.nativeElement.offsetHeight;
            if (width > largestWidthTouchTarget) {
                largestWidthTouchTarget = width;
            }
            
            if (height > largestHeightTouchTarget) {
                largestHeightTouchTarget = height;
            }
        });

        if (this.originalImage && this.cropperMinWidth > 0) {
            this.cropperScaledMinWidth = Math.max(20, this.cropperMinWidth / this.originalImage.width * this.maxSize.width, largestWidthTouchTarget);
            this.cropperScaledMinHeight = this.maintainAspectRatio
                ? Math.max(20, this.cropperScaledMinWidth / this.aspectRatio, largestHeightTouchTarget)
                : Math.max(this.cropperMinHeight / this.originalImage.height * this.maxSize.height, largestHeightTouchTarget);
        } else {
            this.cropperScaledMinWidth = 20;
            this.cropperScaledMinHeight = 20;
        }
    }

    private checkCropperPosition(maintainSize = false): void {
        if (this.cropper.x1 < 0) {
            this.cropper.x2 -= maintainSize ? this.cropper.x1 : 0;
            this.cropper.x1 = 0;
        }
        if (this.cropper.y1 < 0) {
            this.cropper.y2 -= maintainSize ? this.cropper.y1 : 0;
            this.cropper.y1 = 0;
        }
        if (this.cropper.x2 > this.maxSize.width) {
            this.cropper.x1 -= maintainSize ? (this.cropper.x2 - this.maxSize.width) : 0;
            this.cropper.x2 = this.maxSize.width;
        }
        if (this.cropper.y2 > this.maxSize.height) {
            this.cropper.y1 -= maintainSize ? (this.cropper.y2 - this.maxSize.height) : 0;
            this.cropper.y2 = this.maxSize.height;
        }
    }

    @HostListener('document:mouseup')
    @HostListener('document:touchend')
    moveStop(): void {
        if (this.moveStart.active) {
            this.moveStart.active = false;
            this.doAutoCrop();
        }
    }

    zoomScrollWheel(event: WheelEvent) {
        event.preventDefault();
        const isZoomIn = (event.deltaY < 0 ? true : false);
        const scaleIncrement = (event.deltaY < 0 ? 0.1 : -0.1);

        this.zoomImage(isZoomIn, this.imageScale + scaleIncrement, event.pageX, event.pageY);
    }

    private zoomImage(zoomIn: boolean, newScale: number, zoomPageOriginX: number, zoomPageOriginY: number) {
        if (newScale < 1) {
            this.imageTranslateX = 0;
            this.imageTranslateY = 0;
            return;
        } else if (newScale == 1) {
            this.imageTranslateX = 0;
            this.imageTranslateY = 0;
        }
    
        const imageOffset = this.getScaledOffsetInfo(this.sourceImage, this.imageScale, newScale);
        const zoomWindowOffset = this.getOffsetInfo(this.zoomWindow);
        
        const zoomX: number = (zoomPageOriginX - zoomWindowOffset.left) - (zoomWindowOffset.width / 2);
        const zoomY: number = (zoomWindowOffset.height / 2) - (zoomPageOriginY - zoomWindowOffset.top);

        // make sure that the new position with shift will not move passed min top/bottom/right/left
        // if it does only set it to translate the amount to reach top/bottom/right/left of zoom window
        const translationAmount = this.getTranslationAmounts(zoomWindowOffset, imageOffset, zoomX, zoomY, zoomIn);

        this.imageScale = parseFloat((newScale).toFixed(14));
        this.imageTranslateX += (translationAmount.X / newScale);
        this.imageTranslateY += (translationAmount.Y / newScale);
    }

    private getOffsetInfo(element: ElementRef) : ElementPosition{
        var box = element.nativeElement.getBoundingClientRect();
        return {
          left: box.left + (window.pageXOffset - document.documentElement.clientLeft),
          top: box.top + (window.pageYOffset - document.documentElement.clientTop),
          right: box.right,
          bottom: box.bottom,
          width: box.width,
          height: box.height
        };
    }

    private getScaledOffsetInfo(element: ElementRef, oldScale: number, newScale: number) : ElementPosition{
        var box = element.nativeElement.getBoundingClientRect();
        let newScaledWidth: number = element.nativeElement.width * newScale;
        let newScaledHeight: number = element.nativeElement.height * newScale;
        let translateXScaleDifference: number = (this.imageTranslateX * newScale) - (this.imageTranslateX * oldScale);
        let translateYScaleDifference: number = (this.imageTranslateY * newScale) - (this.imageTranslateY * oldScale);

        let scaledOffsetWidthChange = newScaledWidth - box.width;
        let scaledOffsetHeightChange = newScaledHeight - box.height;

        return {
          left: (box.left - (scaledOffsetWidthChange / 2)) + (window.pageXOffset - document.documentElement.clientLeft) + translateXScaleDifference,
          top: (box.top - (scaledOffsetHeightChange / 2)) + (window.pageYOffset - document.documentElement.clientTop) + translateYScaleDifference,
          right: (box.right + (scaledOffsetWidthChange / 2)) + translateXScaleDifference,
          bottom: (box.bottom + (scaledOffsetHeightChange / 2)) + translateYScaleDifference,
          width: newScaledWidth,
          height: newScaledHeight
        };
    }

    getTranslationAmounts(parentElement: ElementPosition, childElement: ElementPosition, zoomPosX: number, zoomPosY: number, isZoomIn: boolean) {
        let translationAmounts = { X: 0, Y: 0 };
        let translateX = Math.ceil(zoomPosX / 10) * (isZoomIn ? -1 : 1);
        let translateY = Math.ceil(zoomPosY / 10) * (isZoomIn ? 1 : -1);

        translationAmounts.X = this.getXTranslation(translateX, parentElement, childElement);
        translationAmounts.Y = this.getYTranslation(translateY, parentElement, childElement);

        return translationAmounts;
    }

    private getXTranslation(translateX: number, parentElement: ElementPosition, childElement: ElementPosition) {
        let x = 0;
        
        if (translateX < 0) {
            let rightPosDifference = parentElement.right - childElement.right;

            if (rightPosDifference - translateX > 0) {
                x = rightPosDifference;
            } else {
                x = translateX;
            }
        } else if (translateX > 0) {
            let leftPosDifference = parentElement.left - childElement.left;

            if (leftPosDifference - translateX < 0) {
                x = leftPosDifference;
            } else {
                x = translateX;
            }
        }

        return x;
    }

    private getYTranslation(translateY: number, parentElement: ElementPosition, childElement: ElementPosition) {
        let y = 0;
        
        if (translateY < 0) {
            let bottomPosDifference = parentElement.bottom - childElement.bottom;

            if (bottomPosDifference - translateY > 0) {
                y = bottomPosDifference;
            } else {
                y = translateY;
            }
        } else if (translateY > 0) {
            let topPosDifference = parentElement.top - childElement.top;

            if (topPosDifference - translateY < 0) {
                y = topPosDifference;
            } else {
                y = translateY;
            }
        } 

        return y;
    }

    private move(event: any) {
        const diffX = this.getClientX(event) - this.moveStart.clientX;
        const diffY = this.getClientY(event) - this.moveStart.clientY;

        this.cropper.x1 = this.moveStart.x1 + diffX;
        this.cropper.y1 = this.moveStart.y1 + diffY;
        this.cropper.x2 = this.moveStart.x2 + diffX;
        this.cropper.y2 = this.moveStart.y2 + diffY;
    }

    private resize(event: any): void {
        const diffX = this.getClientX(event, true) - this.moveStart.clientX;
        const diffY = this.getClientY(event, true) - this.moveStart.clientY;

        switch (this.moveStart.position) {
            case 'left':
                if (!this.validateAspectRatio(Math.min(this.moveStart.x1 + diffX, this.cropper.x2 - this.cropperScaledMinWidth), this.cropper.x2, this.cropper.y1, this.cropper.y2)) {
                    return;
                }

                this.cropper.x1 = Math.min(this.moveStart.x1 + diffX, this.cropper.x2 - this.cropperScaledMinWidth);
                break;
            case 'topleft':
                if (!this.validateAspectRatio(Math.min(this.moveStart.x1 + diffX, this.cropper.x2 - this.cropperScaledMinWidth), this.cropper.x2, Math.min(this.moveStart.y1 + diffY, this.cropper.y2 - this.cropperScaledMinHeight), this.cropper.y2)){
                    return;
                }

                this.cropper.x1 = Math.min(this.moveStart.x1 + diffX, this.cropper.x2 - this.cropperScaledMinWidth);
                this.cropper.y1 = Math.min(this.moveStart.y1 + diffY, this.cropper.y2 - this.cropperScaledMinHeight);
                break;
            case 'top':
                if (!this.validateAspectRatio(this.cropper.x1, this.cropper.x2, Math.min(this.moveStart.y1 + diffY, this.cropper.y2 - this.cropperScaledMinHeight), this.cropper.y2)){
                    return;
                }

                this.cropper.y1 = Math.min(this.moveStart.y1 + diffY, this.cropper.y2 - this.cropperScaledMinHeight);
                break;
            case 'topright':
                if (!this.validateAspectRatio(this.cropper.x1, Math.max(this.moveStart.x2 + diffX, this.cropper.x1 + this.cropperScaledMinWidth), Math.min(this.moveStart.y1 + diffY, this.cropper.y2 - this.cropperScaledMinHeight), this.cropper.y2)){
                    return;
                }

                this.cropper.x2 = Math.max(this.moveStart.x2 + diffX, this.cropper.x1 + this.cropperScaledMinWidth);
                this.cropper.y1 = Math.min(this.moveStart.y1 + diffY, this.cropper.y2 - this.cropperScaledMinHeight);
                break;
            case 'right':
                if (!this.validateAspectRatio(this.cropper.x1, Math.max(this.moveStart.x2 + diffX, this.cropper.x1 + this.cropperScaledMinWidth), this.cropper.y1, this.cropper.y2)) {
                    return;
                }

                this.cropper.x2 = Math.max(this.moveStart.x2 + diffX, this.cropper.x1 + this.cropperScaledMinWidth);
                break;
            case 'bottomright':
                if (!this.validateAspectRatio(this.cropper.x1, Math.max(this.moveStart.x2 + diffX, this.cropper.x1 + this.cropperScaledMinWidth), this.cropper.y1, Math.max(this.moveStart.y2 + diffY, this.cropper.y1 + this.cropperScaledMinHeight))){
                    return;
                }

                this.cropper.x2 = Math.max(this.moveStart.x2 + diffX, this.cropper.x1 + this.cropperScaledMinWidth);
                this.cropper.y2 = Math.max(this.moveStart.y2 + diffY, this.cropper.y1 + this.cropperScaledMinHeight);
                break;
            case 'bottom':
                if (!this.validateAspectRatio(this.cropper.x1, this.cropper.x2, this.cropper.y1, Math.max(this.moveStart.y2 + diffY, this.cropper.y1 + this.cropperScaledMinHeight))){
                    return;
                }

                this.cropper.y2 = Math.max(this.moveStart.y2 + diffY, this.cropper.y1 + this.cropperScaledMinHeight);
                break;
            case 'bottomleft':
                if (!this.validateAspectRatio(Math.min(this.moveStart.x1 + diffX, this.cropper.x2 - this.cropperScaledMinWidth), this.cropper.x2, this.cropper.y1, Math.max(this.moveStart.y2 + diffY, this.cropper.y1 + this.cropperScaledMinHeight))){
                    return;
                }

                this.cropper.x1 = Math.min(this.moveStart.x1 + diffX, this.cropper.x2 - this.cropperScaledMinWidth);
                this.cropper.y2 = Math.max(this.moveStart.y2 + diffY, this.cropper.y1 + this.cropperScaledMinHeight);
                break;
        }

        if (this.maintainAspectRatio) {
            this.checkAspectRatio();
        }
    }

    private validateAspectRatio(x1: number, x2: number, y1: number, y2: number) {
        // check if we are going to violate the min/max aspect ratio
        const newAspectRatio = (x2 - x1) / (y2 - y1);

        if (!this.maintainAspectRatio && ((this.cropperMinAspectRatio != 0 && newAspectRatio < this.cropperMinAspectRatio) || (this.cropperMaxAspectRatio != 0 && newAspectRatio > this.cropperMaxAspectRatio))) {
            return false;
        }

        return true;
    }

    private checkAspectRatio(): void {
        let overflowX = 0;
        let overflowY = 0;

        switch (this.moveStart.position) {
            case 'top':
                this.cropper.x2 = this.cropper.x1 + (this.cropper.y2 - this.cropper.y1) * this.aspectRatio;
                overflowX = Math.max(this.cropper.x2 - this.maxSize.width, 0);
                overflowY = Math.max(0 - this.cropper.y1, 0);
                if (overflowX > 0 || overflowY > 0) {
                    this.cropper.x2 -= (overflowY * this.aspectRatio) > overflowX ? (overflowY * this.aspectRatio) : overflowX;
                    this.cropper.y1 += (overflowY * this.aspectRatio) > overflowX ? overflowY : overflowX / this.aspectRatio;
                }
                break;
            case 'bottom':
                this.cropper.x2 = this.cropper.x1 + (this.cropper.y2 - this.cropper.y1) * this.aspectRatio;
                overflowX = Math.max(this.cropper.x2 - this.maxSize.width, 0);
                overflowY = Math.max(this.cropper.y2 - this.maxSize.height, 0);
                if (overflowX > 0 || overflowY > 0) {
                    this.cropper.x2 -= (overflowY * this.aspectRatio) > overflowX ? (overflowY * this.aspectRatio) : overflowX;
                    this.cropper.y2 -= (overflowY * this.aspectRatio) > overflowX ? overflowY : (overflowX / this.aspectRatio);
                }
                break;
            case 'topleft':
                this.cropper.y1 = this.cropper.y2 - (this.cropper.x2 - this.cropper.x1) / this.aspectRatio;
                overflowX = Math.max(0 - this.cropper.x1, 0);
                overflowY = Math.max(0 - this.cropper.y1, 0);
                if (overflowX > 0 || overflowY > 0) {
                    this.cropper.x1 += (overflowY * this.aspectRatio) > overflowX ? (overflowY * this.aspectRatio) : overflowX;
                    this.cropper.y1 += (overflowY * this.aspectRatio) > overflowX ? overflowY : overflowX / this.aspectRatio;
                }
                break;
            case 'topright':
                this.cropper.y1 = this.cropper.y2 - (this.cropper.x2 - this.cropper.x1) / this.aspectRatio;
                overflowX = Math.max(this.cropper.x2 - this.maxSize.width, 0);
                overflowY = Math.max(0 - this.cropper.y1, 0);
                if (overflowX > 0 || overflowY > 0) {
                    this.cropper.x2 -= (overflowY * this.aspectRatio) > overflowX ? (overflowY * this.aspectRatio) : overflowX;
                    this.cropper.y1 += (overflowY * this.aspectRatio) > overflowX ? overflowY : overflowX / this.aspectRatio;
                }
                break;
            case 'right':
            case 'bottomright':
                this.cropper.y2 = this.cropper.y1 + (this.cropper.x2 - this.cropper.x1) / this.aspectRatio;
                overflowX = Math.max(this.cropper.x2 - this.maxSize.width, 0);
                overflowY = Math.max(this.cropper.y2 - this.maxSize.height, 0);
                if (overflowX > 0 || overflowY > 0) {
                    this.cropper.x2 -= (overflowY * this.aspectRatio) > overflowX ? (overflowY * this.aspectRatio) : overflowX;
                    this.cropper.y2 -= (overflowY * this.aspectRatio) > overflowX ? overflowY : overflowX / this.aspectRatio;
                }
                break;
            case 'left':
            case 'bottomleft':
                this.cropper.y2 = this.cropper.y1 + (this.cropper.x2 - this.cropper.x1) / this.aspectRatio;
                overflowX = Math.max(0 - this.cropper.x1, 0);
                overflowY = Math.max(this.cropper.y2 - this.maxSize.height, 0);
                if (overflowX > 0 || overflowY > 0) {
                    this.cropper.x1 += (overflowY * this.aspectRatio) > overflowX ? (overflowY * this.aspectRatio) : overflowX;
                    this.cropper.y2 -= (overflowY * this.aspectRatio) > overflowX ? overflowY : overflowX / this.aspectRatio;
                }
                break;
        }
    }

    private doAutoCrop(): void {
        if (this.autoCrop) {
            this.crop();
        }
    }

    crop(outputType: OutputType = this.outputType, maxWidth?: number, maxHeight?: number): ImageCroppedEvent | Promise<ImageCroppedEvent> | null {
        if (this.sourceImage.nativeElement && this.originalImage != null) {
            this.startCropImage.emit();
            const imagePosition = this.getImagePosition();
            const width = imagePosition.x2 - imagePosition.x1;
            const height = imagePosition.y2 - imagePosition.y1;

            let cropWidth: number = width;
            let cropHeight: number = height;
            const aspectRatio = width / height;

            if (maxWidth && maxWidth != 0 && cropWidth > maxWidth) {
                cropWidth = maxWidth;
                cropHeight = cropWidth / aspectRatio;
            }

            if (maxHeight && maxWidth != 0 && cropHeight > maxHeight) {
                cropHeight = maxHeight;
                cropWidth = cropHeight * aspectRatio;
            }

            const cropCanvas = document.createElement('canvas') as HTMLCanvasElement;
            cropCanvas.width = cropWidth;
            cropCanvas.height = cropHeight;

            const ctx = cropCanvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(
                    this.originalImage,
                    imagePosition.x1,
                    imagePosition.y1,
                    width,
                    height,
                    0,
                    0,
                    cropWidth,
                    cropHeight
                );

                const output = {width, height, imagePosition, cropperPosition: {...this.cropper}};
                const resizeRatio = this.getResizeRatio(width);
                if (resizeRatio !== 1) {
                    output.width = Math.floor(width * resizeRatio);
                    output.height = Math.floor(height * resizeRatio);
                    resizeCanvas(cropCanvas, output.width, output.height);
                }
                return this.cropToOutputType(outputType, cropCanvas, output);
            }
        }
        return null;
    }

    private getImagePosition(): CropperPosition {
        const sourceImageElement = this.sourceImage.nativeElement;
        const ratio = this.originalSize.width / sourceImageElement.offsetWidth;
        const widthPositionChange = this.imageScale > 1 ? ((this.originalSize.width * this.imageScale) - (this.originalSize.width)) / (2 * this.imageScale) : 0;
        const heightPositionChange = this.imageScale > 1 ? ((this.originalSize.height * this.imageScale) - (this.originalSize.height)) / (2 * this.imageScale) : 0;

        return {
            x1: ((Math.round(this.cropper.x1 * ratio) / this.imageScale) + widthPositionChange - (this.imageTranslateX * ratio)),
            y1: ((Math.round(this.cropper.y1 * ratio) / this.imageScale) + heightPositionChange - (this.imageTranslateY * ratio)),
            x2: ((Math.min(Math.round(this.cropper.x2 * ratio), this.originalSize.width) / this.imageScale) + widthPositionChange - (this.imageTranslateX * ratio)),
            y2: ((Math.min(Math.round(this.cropper.y2  * ratio), this.originalSize.height) / this.imageScale) + heightPositionChange - (this.imageTranslateY * ratio))
        }
    }

    private cropToOutputType(outputType: OutputType, cropCanvas: HTMLCanvasElement, output: ImageCroppedEvent): ImageCroppedEvent | Promise<ImageCroppedEvent> {
        switch (outputType) {
            case 'file':
                return this.cropToFile(cropCanvas)
                    .then((result: Blob | null) => {
                        output.file = result;
                        this.imageCropped.emit(output);
                        return output;
                    });
            case 'both':
                output.base64 = this.cropToBase64(cropCanvas);
                return this.cropToFile(cropCanvas)
                    .then((result: Blob | null) => {
                        output.file = result;
                        this.imageCropped.emit(output);
                        return output;
                    });
            default:
                output.base64 = this.cropToBase64(cropCanvas);
                this.imageCropped.emit(output);
                return output;
        }
    }

    private cropToBase64(cropCanvas: HTMLCanvasElement): string {
        const imageBase64 = cropCanvas.toDataURL('image/' + this.format, this.getQuality());
        this.imageCroppedBase64.emit(imageBase64);
        return imageBase64;
    }

    private cropToFile(cropCanvas: HTMLCanvasElement): Promise<Blob | null> {
        return this.getCanvasBlob(cropCanvas)
            .then((result: Blob | null) => {
                if (result) {
                    this.imageCroppedFile.emit(result);
                }
                return result;
            });
    }

    private getCanvasBlob(cropCanvas: HTMLCanvasElement): Promise<Blob | null> {
        return new Promise((resolve) => {
            cropCanvas.toBlob(
                (result: Blob | null) => this.zone.run(() => resolve(result)),
                'image/' + this.format,
                this.getQuality()
            );
        });
    }

    private getQuality(): number {
        return Math.min(1, Math.max(0, this.imageQuality / 100));
    }

    private getResizeRatio(width: number): number {
        return this.resizeToWidth > 0 && (!this.onlyScaleDown || width > this.resizeToWidth)
            ? this.resizeToWidth / width
            : 1;
    }

    private getClientX(event: any, limitToViewBounds?: boolean): number {
        const offsetInfo = this.getOffsetInfo(this.zoomWindow);
        const clientX = event.clientX || event.touches && event.touches[0] && event.touches[0].clientX;
        
        return limitToViewBounds ? this.clamp(clientX, offsetInfo.left, offsetInfo.right) : clientX;
    }

    private getClientY(event: any, limitToViewBounds?: boolean): number {
        const offsetInfo = this.getOffsetInfo(this.zoomWindow);
        const clientY = event.clientY || event.touches && event.touches[0] && event.touches[0].clientY;

        return limitToViewBounds ? this.clamp(clientY, offsetInfo.top, offsetInfo.bottom) : clientY;
    }

    private clamp(value: number, min: number, max: number) {
        return Math.min(Math.max(min, value), max);
    }
}
