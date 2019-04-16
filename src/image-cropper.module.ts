import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImageCropperComponent } from './component/image-cropper.component';
import { HammerGestureConfig, HAMMER_GESTURE_CONFIG } from '@angular/platform-browser';

@NgModule({
    imports: [
        CommonModule
    ],
    declarations: [
        ImageCropperComponent
    ],
    exports: [
        ImageCropperComponent
    ],
    providers: [
    ]
})
export class ImageCropperModule {}
