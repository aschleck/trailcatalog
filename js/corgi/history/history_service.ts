import { EmptyDeps, EmptyResponse } from '../deps';
import { Service } from '../service';

export class HistoryService extends Service<EmptyDeps> {

  constructor(response: EmptyResponse) {
    super(response);
  }

  back(): void {
  }
}
