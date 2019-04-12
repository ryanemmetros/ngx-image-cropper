import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImageCropperComponent } from './component/image-cropper.component';
import { HammerGestureConfig, HAMMER_GESTURE_CONFIG } from '@angular/platform-browser';

export class MyHammerConfig extends HammerGestureConfig  {
  overrides = <any>{
      'pinch': {
        enabled:true,
        pointers: 2,
        threshold: 20
      }
  }
}

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
        { 
            provide: HAMMER_GESTURE_CONFIG, 
            useClass: MyHammerConfig 
        }
    ]
})
export class ImageCropperModule {}
