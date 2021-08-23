import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OverlayModule } from '@angular/cdk/overlay';
import { PortalModule } from '@angular/cdk/portal';

import { TextInputAutocompleteComponent } from './text-input-autocomplete.component';
import { TextInputAutocompleteMenuComponent } from './text-input-autocomplete-menu.component';

@NgModule({
  declarations: [
    TextInputAutocompleteComponent,
    TextInputAutocompleteMenuComponent
  ],
  imports: [CommonModule, OverlayModule, PortalModule],
  exports: [
    TextInputAutocompleteComponent,
    TextInputAutocompleteMenuComponent
  ],
  entryComponents: [TextInputAutocompleteMenuComponent]
})
export class TextInputAutocompleteModule {}
