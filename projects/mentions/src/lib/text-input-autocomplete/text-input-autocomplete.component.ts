import {
  Component,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  Renderer2,
  SimpleChanges,
  TemplateRef,
  ViewChild,
} from '@angular/core';
import { CdkPortal } from '@angular/cdk/portal';
import { ConnectionPositionPair, Overlay, OverlayConfig, OverlayRef, PositionStrategy } from '@angular/cdk/overlay';

import { getCaretCoordinates } from './textarea-caret-position';
// @ts-ignore
// import toPX from 'to-px';

export interface ChoiceWithIndices {
  choice: any;
  occurence: number;
  indices: {
    start: number;
    end: number;
  };
}

@Component({
  selector: 'flx-text-input-autocomplete',
  templateUrl: './text-input-autocomplete.component.html',
  styleUrls: ['./text-input-autocomplete.component.scss'],
})
export class TextInputAutocompleteComponent implements OnChanges, OnInit, OnDestroy {
  @ViewChild('menuPortal', { static: true }) menuPortal: CdkPortal;

  /**
   * Reference to the text input element.
   */
  @Input() textInputElement: HTMLTextAreaElement | HTMLInputElement;

  /**
   * Reference to the menu template (used to display the search results).
   */
  @Input() menuTemplate: TemplateRef<any>;

  /**
   * The character which will trigger the search.
   */
  @Input() triggerCharacter = '@';

  /**
   * The regular expression that will match the search text after the trigger character.
   * No match will hide the menu.
   */
  @Input() searchRegexp = /^\w*$/;

  /**
   * whether to use static placed overlay or cdk overlay
   */
  @Input() useCDKOverlay?: boolean;

  /**
   * Whether to close the menu when the host textInputElement loses focus.
   */
  @Input() closeMenuOnBlur = false;

  /**
   * Pre-set choices for edit text mode, or to select/mark choices from outside the mentions component.
   */
  @Input() selectedChoices: any[] = [];

  /**
   * A function that formats the selected choice once selected.
   * The result (label) is also used as a choice identifier (e.g. when editing choices).
   */
  @Input() getChoiceLabel: (choice: any) => string;

  /**
   * Called when the choices menu is shown.
   */
  @Output() menuShow = new EventEmitter();

  /**
   * Called when the choices menu is hidden.
   */
  @Output() menuHide = new EventEmitter();

  /**
   * Called when a choice is selected.
   */
  @Output() choiceSelected = new EventEmitter<ChoiceWithIndices>();

  /**
   * Called when a choice is removed.
   */
  @Output() choiceRemoved = new EventEmitter<ChoiceWithIndices>();

  /**
   * Called when a choice is selected, removed, or if any of the choices' indices change.
   */
  @Output() selectedChoicesChange = new EventEmitter<ChoiceWithIndices[]>();

  /**
   * Called on user input after entering trigger character. Emits search term to search by.
   */
  @Output() search = new EventEmitter<string>();

  private _eventListeners: Array<() => void> = [];

  private _selectedCwis: ChoiceWithIndices[] = [];
  private _dumpedCwis: ChoiceWithIndices[] = [];
  private _editingCwi: ChoiceWithIndices;

  menuCtrl?: {
    template: TemplateRef<any>;
    context: any;
    position: {
      top: number;
      left: number;
    };
    triggerCharacterPosition: number;
    lastCaretPosition?: number;
  };
  private overlayRef: OverlayRef;

  constructor(private ngZone: NgZone, private renderer: Renderer2, private overlay: Overlay) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes.selectedChoices) {
      if (Array.isArray(this.selectedChoices)) {
        /**
         * Timeout needed since ngOnChanges is fired before the textInputElement value is updated.
         * The problem is specific to publisher.landing component implementation, i.e. single
         * textarea element is used for each account, only text changes..
         * Use ngZone.runOutsideAngular to optimize the timeout so it doesn't fire
         * global change detection events continuously..
         */
        this.ngZone.runOutsideAngular(() => {
          setTimeout(() => {
            const selectedCwisPrevious = JSON.stringify(this._selectedCwis);

            this._selectedCwis = this.selectedChoices.map((c) => {
              return {
                choice: c,
                occurence: -1,
                indices: { start: -1, end: -1 },
              };
            });
            this.updateIndices();

            // Remove choices that index couldn't be found for
            this._selectedCwis = this._selectedCwis.filter((cwi) => cwi.indices.start > -1 && cwi.occurence > -1);

            if (JSON.stringify(this._selectedCwis) !== selectedCwisPrevious) {
              // TODO: Should check for indices change only (ignoring the changes inside choice object)
              this.ngZone.run(() => {
                this.selectedChoicesChange.emit(this._selectedCwis);
              });
            }
          });
        });
      }
    }
  }

  ngOnInit() {
    const onKeydown = this.renderer.listen(this.textInputElement, 'keydown', (event) => this.onKeydown(event));
    this._eventListeners.push(onKeydown);

    const onInput = this.renderer.listen(this.textInputElement, 'input', (event) => this.onInput(event));
    this._eventListeners.push(onInput);

    const onBlur = this.renderer.listen(this.textInputElement, 'blur', (event) => this.onBlur(event));
    this._eventListeners.push(onBlur);

    const onClick = this.renderer.listen(this.textInputElement, 'click', (event) => this.onClick(event));
    this._eventListeners.push(onClick);
  }

  ngOnDestroy() {
    this.hideMenu();
    this._eventListeners.forEach((unregister) => unregister());
  }

  onKeydown(event: KeyboardEvent): void {
    const cursorPosition = this.textInputElement.selectionStart;
    const precedingChar = this.textInputElement.value.charAt(cursorPosition - 1);

    if (event.key === this.triggerCharacter && precedingCharValid(precedingChar)) {
      this.showMenu();
      return;
    }

    const keyCode = event.keyCode || event.charCode;
    if (keyCode === 8 || keyCode === 46) {
      // backspace or delete
      const cwiToEdit = this._selectedCwis.find((cwi) => {
        const label = this.getChoiceLabel(cwi.choice);
        const labelEndIndex = this.getChoiceIndex(label, cwi.occurence) + label.length;
        return cursorPosition === labelEndIndex;
      });

      if (cwiToEdit) {
        this.editChoice(cwiToEdit);
      }
    }
  }

  onInput(event: any): void {
    const value = event.target.value;
    const selectedCwisPrevious = JSON.stringify(this._selectedCwis);

    if (!this.menuCtrl) {
      // dump choices that are removed from the text (e.g. select all + paste),
      // and/or retrieve them if user e.g. UNDO the action
      // BUG: if text that contains mentions is selected and deleted using trigger char, no choices will be dumped (this.menuCtrl will be defined)!
      this.dumpNonExistingChoices();
      this.retrieveExistingChoices();
      this.updateIndices();
      if (JSON.stringify(this._selectedCwis) !== selectedCwisPrevious) {
        // TODO: Should probably check for indices change only (ignoring the changes inside choice object)
        this.selectedChoicesChange.emit(this._selectedCwis);
      }
      return;
    }

    this.updateIndices();
    if (JSON.stringify(this._selectedCwis) !== selectedCwisPrevious) {
      this.selectedChoicesChange.emit(this._selectedCwis);
    }

    if (value[this.menuCtrl.triggerCharacterPosition] !== this.triggerCharacter) {
      this.hideMenu();
      return;
    }

    const cursorPosition = this.textInputElement.selectionStart;
    if (cursorPosition < this.menuCtrl.triggerCharacterPosition) {
      this.hideMenu();
      return;
    }

    const searchText = value.slice(this.menuCtrl.triggerCharacterPosition + 1, cursorPosition);
    if (!searchText.match(this.searchRegexp)) {
      this.hideMenu();
      return;
    }

    this.search.emit(searchText);
  }

  onBlur(event: FocusEvent): void {
    if (!this.menuCtrl) {
      return;
    }

    this.menuCtrl.lastCaretPosition = this.textInputElement.selectionStart;

    if (this.closeMenuOnBlur) {
      setTimeout(() => {
        this.hideMenu();
      }, 100);
    }
  }

  onClick(event: MouseEvent): void {
    if (!this.menuCtrl) {
      return;
    }

    const cursorPosition = this.textInputElement.selectionStart;
    if (cursorPosition <= this.menuCtrl.triggerCharacterPosition) {
      this.hideMenu();
      return;
    }

    const searchText = this.textInputElement.value.slice(this.menuCtrl.triggerCharacterPosition + 1, cursorPosition);
    if (!searchText.match(this.searchRegexp)) {
      this.hideMenu();
      return;
    }
  }

  private getPositionStrategy(caretY: number, caretX: number, lineHeight: number): PositionStrategy {
    const { top: elY, left: elX } = this.textInputElement.getBoundingClientRect();
    const height = this.textInputElement.offsetHeight;

    const point = {
      y: elY + ((caretY > height ? caretY + lineHeight : caretY + lineHeight / 2) % height),
      x: elX + caretX,
    };
    // console.log('caretX: ', caretX, ', caretY: ', caretY);
    // console.log('height: ', height, ', lineHeight: ', lineHeight);
    // console.log('elX: ', elX, ', elY: ', elY);
    // console.log('point: ', point);
    return this.overlay
      .position()
      .flexibleConnectedTo(point)
      .withFlexibleDimensions(false)
      .withPositions([
        new ConnectionPositionPair({ originX: 'start', originY: 'bottom' }, { overlayX: 'start', overlayY: 'top' }),
        new ConnectionPositionPair({ originX: 'start', originY: 'top' }, { overlayX: 'start', overlayY: 'bottom' }),
      ])
      .withPush(true);
  }

  private hideMenu() {
    if (!this.menuCtrl) {
      return;
    }

    this.menuCtrl = undefined;
    if (this.useCDKOverlay) {
      this.overlayRef.detach();
    }
    this.menuHide.emit();

    if (this._editingCwi) {
      // If user didn't make any changes to it, add it back to the selected choices
      const label = this.getChoiceLabel(this._editingCwi.choice);
      const labelExists = this.getChoiceIndex(label + ' ', this._editingCwi.occurence) > -1;
      const choiceExists = this._selectedCwis.find(
        (cwi) => this.getChoiceLabel(cwi.choice) === label && cwi.occurence === this._editingCwi.occurence
      );
      if (labelExists && !choiceExists) {
        this.addToSelected(this._editingCwi);
        this.updateIndices();
        this.selectedChoicesChange.emit(this._selectedCwis);
      }
    }
    this._editingCwi = undefined;
  }

  private showMenu() {
    if (this.menuCtrl) {
      return;
    }

    const lineHeight = this.getLineHeight(this.textInputElement);
    const { top, left } = getCaretCoordinates(this.textInputElement, this.textInputElement.selectionStart);

    this.menuCtrl = {
      template: this.menuTemplate,
      context: {
        selectChoice: this.selectChoice,
        // $implicit: {
        //   selectChoice: this.selectChoice
        // },
      },
      position: {
        top: top + lineHeight,
        left: left,
      },
      triggerCharacterPosition: this.textInputElement.selectionStart,
    };

    if (this.useCDKOverlay) {
      if (this.overlayRef) {
        this.overlayRef.detach();
      }
      setTimeout(() => {
        this.overlayRef = this.overlay.create(
          new OverlayConfig({
            positionStrategy: this.getPositionStrategy(top, left, lineHeight),
            scrollStrategy: this.overlay.scrollStrategies.close(),
          })
        );
        this.overlayRef.attach(this.menuPortal);
      });
    }

    this.menuShow.emit();
  }

  private getOccurenceCount(label: string) {
    return (this._selectedCwis || []).reduce((count, cwi) => {
      return this.getChoiceLabel(cwi.choice) === label ? count + 1 : count;
    }, 0);
  }

  selectChoice = (choice: any) => {
    const label = this.getChoiceLabel(choice);
    const startIndex = this.menuCtrl!.triggerCharacterPosition;
    const start = this.textInputElement.value.slice(0, startIndex);
    const caretPosition = this.menuCtrl!.lastCaretPosition || this.textInputElement.selectionStart;
    const end = this.textInputElement.value.slice(caretPosition);
    const insertValue = label + ' ';
    this.textInputElement.value = start + insertValue + end;
    // force ng model / form control to update
    this.textInputElement.dispatchEvent(new Event('input'));

    const setCursorAt = (start + insertValue).length;
    this.textInputElement.setSelectionRange(setCursorAt, setCursorAt);
    this.textInputElement.focus();
    const occurence = this.getOccurenceCount(label) + 1;

    const choiceWithIndices = {
      choice,
      occurence,
      indices: {
        start: startIndex,
        end: startIndex + label.length,
      },
    };

    this.addToSelected(choiceWithIndices);
    this.updateIndices();
    this.selectedChoicesChange.emit(this._selectedCwis);

    this.hideMenu();
  };

  editChoice(cwiToEdit: ChoiceWithIndices): void {
    const label = this.getChoiceLabel(cwiToEdit.choice);
    const startIndex = cwiToEdit.indices.start;
    const endIndex = cwiToEdit.indices.end;

    this._editingCwi = cwiToEdit;
    this.removeFromSelected(this._editingCwi);
    this.selectedChoicesChange.emit(this._selectedCwis);

    this.textInputElement.focus();
    this.textInputElement.setSelectionRange(endIndex, endIndex);

    this.showMenu();
    this.menuCtrl.triggerCharacterPosition = startIndex;

    // TODO: editValue to be provided externally?
    const editValue = label.replace(this.triggerCharacter, '');
    this.search.emit(editValue);
  }

  dumpNonExistingChoices(): void {
    const choicesToDump = this._selectedCwis.filter((cwi) => {
      const label = this.getChoiceLabel(cwi.choice);
      return this.getChoiceIndex(label, cwi.occurence) === -1;
    });

    if (choicesToDump.length) {
      choicesToDump.forEach((cwi) => {
        this.removeFromSelected(cwi);
        this._dumpedCwis.push(cwi);
      });
    }
  }

  retrieveExistingChoices(): void {
    const choicesToRetrieve = this._dumpedCwis.filter((dcwi) => {
      const label = this.getChoiceLabel(dcwi.choice);
      const labelExists = this.getChoiceIndex(label, dcwi.occurence) > -1;
      const choiceExists = this._selectedCwis.find(
        (scwi) => this.getChoiceLabel(scwi.choice) === label && scwi.occurence === dcwi.occurence
      );
      return labelExists && !choiceExists;
    });

    if (choicesToRetrieve.length) {
      choicesToRetrieve.forEach((c) => {
        this.addToSelected(c);
        this._dumpedCwis.splice(this._dumpedCwis.indexOf(c), 1);
      });
    }
  }

  addToSelected(cwi: ChoiceWithIndices): void {
    const label = this.getChoiceLabel(cwi.choice);
    const exists = this._selectedCwis.some(
      (scwi) => this.getChoiceLabel(scwi.choice) === label && scwi.occurence === cwi.occurence
    );

    if (!exists) {
      this._selectedCwis.push(cwi);
      this.choiceSelected.emit(cwi);
    }
  }

  removeFromSelected(cwi: ChoiceWithIndices): void {
    const exists = this._selectedCwis.some(
      (scwi) => this.getChoiceLabel(scwi.choice) === this.getChoiceLabel(cwi.choice) && scwi.occurence === cwi.occurence
    );

    if (exists) {
      this._selectedCwis.splice(this._selectedCwis.indexOf(cwi), 1);
      this.choiceRemoved.emit(cwi);
    }
  }

  getLineHeight(elm: HTMLElement): number {
    const lineHeightStr = getComputedStyle(elm).lineHeight || '';
    const lineHeight = parseFloat(lineHeightStr);
    const normalLineHeight = 1.2;

    const fontSizeStr = getComputedStyle(elm).fontSize || '';
    // const fontSize = +toPX(fontSizeStr);
    const fontSize = parseFloat(fontSizeStr);

    if (lineHeightStr === lineHeight + '') {
      return fontSize * lineHeight;
    }

    if (lineHeightStr.toLowerCase() === 'normal') {
      return fontSize * normalLineHeight;
    }

    // return toPX(lineHeightStr);
    return parseFloat(lineHeightStr);
  }

  getChoiceIndex(label: string, occurence: number): number {
    const text = this.textInputElement && this.textInputElement.value;
    const labels = this._selectedCwis.map((cwi) => this.getChoiceLabel(cwi.choice));

    return getChoiceIndex(text, label, occurence, labels);
  }

  updateIndices(): void {
    const occurenceMap = {};
    this._selectedCwis = this._selectedCwis.map((cwi) => {
      const label = this.getChoiceLabel(cwi.choice);
      occurenceMap[label] = occurenceMap[label] === undefined ? 1 : occurenceMap[label] + 1;
      const index = this.getChoiceIndex(label, occurenceMap[label]);
      return {
        choice: cwi.choice,
        occurence: occurenceMap[label],
        indices: {
          start: index,
          end: index + label.length,
        },
      };
    });
  }
}

export function getChoiceIndex(text: string, label: string, occurence: number = 1, labels: string[] = []): number {
  text = text || '';

  labels.forEach((l) => {
    // Mask other labels that contain given label,
    // e.g. if the given label is '@TED', mask '@TEDEducation' label
    if (l !== label && l.indexOf(label) > -1) {
      text = text.replace(new RegExp(l, 'g'), '*'.repeat(l.length));
    }
  });

  return findStringIndex(text, label, occurence, (startIndex, endIndex) => {
    // Only labels that are preceded with below defined chars are valid,
    // (avoid 'labels' found in e.g. links being mistaken for choices)
    const precedingChar = text[startIndex - 1];
    return precedingCharValid(precedingChar) || text.slice(startIndex - 4, startIndex) === '<br>';
  });
}

export function precedingCharValid(char: string): boolean {
  return !char || char === '\n' || char === ' ' || char === '(';
}

// TODO: move to common!
export function findStringIndex(
  text: string,
  value: string,
  occurence: number,
  callback: (startIndex: number, endIndex: number) => boolean
): number {
  let index = text.indexOf(value);
  if (index === -1) {
    return -1;
  }
  while (occurence > 1) {
    index = text.indexOf(value, index + 1);
    --occurence;
  }

  let conditionMet = callback(index, index + value.length);

  while (!conditionMet && index > -1) {
    index = text.indexOf(value, index + 1);
    conditionMet = callback(index, index + value.length);
  }

  return index;
}
