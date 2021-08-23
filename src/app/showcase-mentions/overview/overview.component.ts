import { Component } from '@angular/core';
import { TemplateTag } from './tag-textarea/tag-textarea.component';

@Component({
  selector: 'app-overview',
  templateUrl: './overview.component.html',
  styleUrls: ['./overview.component.scss'],
})
export class OverviewComponent {
  value = '';
    tags: TemplateTag[] = [
      {
        name: 'Amelia',
        value: 'Amelia',
      },
      {
        name: 'Doe',
        value: 'Doe',
      },
      {
        name: 'John Doe',
        value: 'John Doe',
      },
      {
        name: 'John J. Doe',
        value: 'John J. Doe',
      },
      {
        name: 'John & Doe',
        value: 'John & Doe',
      },
      {
        name: 'Fredericka Wilkie',
        value: 'Fredericka Wilkie',
      },
      {
        name: 'Collin Warden',
        value: 'Collin Warden',
      },
      {
        name: 'Hyacinth Hurla',
        value: 'Hyacinth Hurla',
      },
      {
        name: 'Paul Bud Mazzei',
        value: 'Paul Bud Mazzei',
      },
      {
        name: 'Mamie Xander Blais',
        value: 'Mamie Xander Blais',
      },
      {
        name: 'Sacha Murawski',
        value: 'Sacha Murawski',
      },
      {
        name: 'Marcellus Van Cheney',
        value: 'Marcellus Van Cheney',
      },
      {
        name: 'Lamar Kowalski',
        value: 'Lamar Kowalski',
      },
      {
        name: 'Queena Gauss',
        value: 'Queena Gauss',
      },
    ];
}
