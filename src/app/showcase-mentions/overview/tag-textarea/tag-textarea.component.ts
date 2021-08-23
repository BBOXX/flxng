import { Component, Input, OnInit, Optional, Self, ViewEncapsulation } from '@angular/core';
import { AbstractControl, ControlValueAccessor, NgControl } from '@angular/forms';
import { ChoiceWithIndices } from '@flxng/mentions';

export class TemplateTag {
  name: string;
  value: string;
}

@Component({
    selector: 'app-tag-textarea',
    templateUrl: './tag-textarea.component.html',
    styleUrls: ['./styles.scss'],
    encapsulation: ViewEncapsulation.None
})
export class TagTextareaComponent implements OnInit, ControlValueAccessor {
    @Input() tags: TemplateTag[];
    @Input() label: string;
    isDisabled: boolean;
    value: string;

    filteredTags: TemplateTag[] = [];
    selectedTags: ChoiceWithIndices[] = [];
    defaultSelectedTags: TemplateTag[];
    control: AbstractControl;

    // Control value accessors
    onTouchedCallback: () => any;
    onChangeCallback: (_: any) => any;

    constructor(@Optional() @Self() private controlDir: NgControl) {
        if (this.controlDir) {
            this.controlDir.valueAccessor = this;
        }
    }

    ngOnInit() {
        this.control = this.controlDir.control;
    }

    getTagLabel = (tag: TemplateTag): string => `[${tag.value}]`;

    filterTags(searchTerm: string): TemplateTag[] {
        if (searchTerm.endsWith(']')) {
            searchTerm = searchTerm.slice(0, searchTerm.length - 1);
        }
        this.filteredTags = this.tags.filter(({ name }) => name.toLowerCase().indexOf(searchTerm.toLowerCase()) > -1);
        return this.filteredTags;
    }

    getSelectedTags(): TemplateTag[] {
        if (this.selectedTags.length) {
            return this.selectedTags.map((m) => m.choice);
        } else {
            return this.defaultSelectedTags;
        }
    }

    onSelectedTagsChange(choices: ChoiceWithIndices[]) {
        this.selectedTags = choices;
    }

    onMenuHide(): void {
        this.filteredTags = [];
    }

    onChange() {
        this.onChangeCallback(this.value);
    }

    onBlur() {
        this.onTouchedCallback();
    }

    calculateSelectedTags() {
        const tags = (this.value || '').match(/\[[.^\]^\w]*\]/g) || [];
        this.defaultSelectedTags = tags.map((tag) =>
            this.tags.find(({ value }) => value === tag.replace(/\[([.^\]^\w]*)\]/, '$1'))
        );
    }

    /**
     *
     * Methods Implementation for ControlValueAccessor Interface
     */

    writeValue(value: string): void {
        this.value = value;
        this.calculateSelectedTags();
    }

    registerOnChange(fn: any): void {
        this.onChangeCallback = fn;
    }

    registerOnTouched(fn: any): void {
        this.onTouchedCallback = fn;
    }

    setDisabledState?(isDisabled: boolean): void {
        this.isDisabled = isDisabled;
    }
}
