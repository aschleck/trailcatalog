import {
  CreateCollectionRequestSchema,
  CreateCollectionResponseSchema,
  DataService,
  GetCollectionRequestSchema,
  GetCollectionResponseSchema,
  GetCurrentUserRequestSchema,
  GetCurrentUserResponseSchema,
  ListCollectionsRequestSchema,
  ListCollectionsResponseSchema,
  SaveRequestSchema,
  SaveResponseSchema,
} from 'trails_lat/proto/data_pb';

export const BACKENDS = {
  'lat.trails.DataService': {
    service: DataService,
    methods: {
      createCollection: [CreateCollectionRequestSchema, CreateCollectionResponseSchema],
      getCollection: [GetCollectionRequestSchema, GetCollectionResponseSchema],
      getCurrentUser: [GetCurrentUserRequestSchema, GetCurrentUserResponseSchema],
      listCollections: [ListCollectionsRequestSchema, ListCollectionsResponseSchema],
      save: [SaveRequestSchema, SaveResponseSchema],
    },
  },
} as const;
