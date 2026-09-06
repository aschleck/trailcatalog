import {
  DataService,
  GetCurrentUserRequestSchema,
  GetCurrentUserResponseSchema,
  ListCollectionsRequestSchema,
  ListCollectionsResponseSchema,
} from 'trails_lat/proto/data_pb';

export const BACKENDS = {
  'lat.trails.DataService': {
    service: DataService,
    methods: {
      getCurrentUser: [GetCurrentUserRequestSchema, GetCurrentUserResponseSchema],
      listCollections: [ListCollectionsRequestSchema, ListCollectionsResponseSchema],
    },
  },
} as const;
