import {
  CreateCollectionRequestSchema,
  CreateCollectionResponseSchema,
  DataService,
  DeleteLineRequestSchema,
  DeleteLineResponseSchema,
  GetCollectionRequestSchema,
  GetCollectionResponseSchema,
  GetCurrentUserRequestSchema,
  GetCurrentUserResponseSchema,
  ListCollectionsRequestSchema,
  ListCollectionsResponseSchema,
  PutLineRequestSchema,
  PutLineResponseSchema,
} from 'trails_lat/proto/data_pb';

export const BACKENDS = {
  'lat.trails.DataService': {
    service: DataService,
    methods: {
      createCollection: [CreateCollectionRequestSchema, CreateCollectionResponseSchema],
      deleteLine: [DeleteLineRequestSchema, DeleteLineResponseSchema],
      getCollection: [GetCollectionRequestSchema, GetCollectionResponseSchema],
      getCurrentUser: [GetCurrentUserRequestSchema, GetCurrentUserResponseSchema],
      listCollections: [ListCollectionsRequestSchema, ListCollectionsResponseSchema],
      putLine: [PutLineRequestSchema, PutLineResponseSchema],
    },
  },
} as const;
